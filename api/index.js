import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import mqtt from 'mqtt';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';

/* Env & DB  */
const getEnvOrThrow = (key) => {
  if (!process.env[key]) throw new Error(`Missing env var ${key}`);
  return process.env[key];
};
const PORT = process.env.PORT || 3000;

//database connection pool
const gatekeeperDb = await mysql.createPool({
  host: getEnvOrThrow('DB_HOST'),
  user: getEnvOrThrow('DB_USER'),
  password: getEnvOrThrow('DB_PASS'),
  database: getEnvOrThrow('DB_NAME'),
  waitForConnections: true,
  connectionLimit: 5,
});

//create web server
/*  App  */
const app = express();

//Frontend allowed to call API
const allowedOrigins = (process.env.ORIGINS ? process.env.ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://172.31.0.137:5173']);

// Allow requests from specific frontend origins
app.use(cors({ origin: allowedOrigins, credentials: false }));

// Parse JSON request bodies
app.use(express.json());

// Serve static files from /public (e.g. health page)
app.use(express.static('public')); 

// Log incoming request
app.use((req, _res, next) => { console.log(req.method, req.url); next(); });

// Health check endpoints
app.get('/api/admin/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// List up to 100 users for admin UI
app.get('/api/admin/users', async (_req, res) => {
  const [rows] = await gatekeeperDb.query(
    'SELECT id, full_name, active, current_pin_id, created_at FROM users ORDER BY id DESC LIMIT 100;'
  );
  res.json(rows);
});

// Create a new user
app.post('/api/admin/users', async (req, res) => {
    // Extract full_name and active from request body.
   // If active is not given, default to 1
  const { full_name, active = 1 } = req.body || {};

   // Validate: full_name must exist and be a string.
   // If not, return 400 Bad Request with an error message
  if (!full_name || typeof full_name !== 'string') {
    return res.status(400).json({ error: 'full_name_required' });
  }

    // Insert the new user into the database.
    // Use parameterized query ? to prevent SQL injection.
    // Trim spaces from name, and store active.
  const [result] = await gatekeeperDb.query(
    'INSERT INTO users (full_name, active) VALUES (?, ?);',
    [full_name.trim(), active ? 1 : 0]
  );

    // Query the database again to fetch the newly created user
    // by its auto generated ID result.insertId.
  const [rows] = await gatekeeperDb.query(
    'SELECT id, full_name, active, current_pin_id, created_at FROM users WHERE id=?;',
    [result.insertId]
  );
  

  // Respond with 201 Created and return the new user as JSON.
  res.status(201).json(rows[0]);
});

// Update an existing user (partial update: only fields sent are changed)
app.patch('/api/admin/users/:id', async (req, res) => {
    // Convert :id from string to number
  const id = Number(req.params.id); 
  // Validate id is an integer
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }
  const setParts = [];
  const params = [];
  if (typeof req.body.full_name === 'string') { setParts.push('full_name=?'); params.push(req.body.full_name.trim()); }
  if (req.body.active !== undefined) { setParts.push('active=?'); params.push(req.body.active ? 1 : 0); }
  if (req.body.current_pin_id !== undefined) { setParts.push('current_pin_id=?'); params.push(req.body.current_pin_id ?? null); }
  if (!setParts.length) return res.status(400).json({ error: 'no_fields' });

  const isDeactivating = req.body.active === 0 || req.body.active === false;
  const isActivating   = req.body.active === 1 || req.body.active === true;

  const conn = await gatekeeperDb.getConnection();
  try {
    await conn.beginTransaction();

    // 1) apply user changes
    values.push(id);
    await conn.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id=?;`, values);

    // 2) cascades
    if (isDeactivating) {
      // all cards OFF
      await conn.query('UPDATE rfid_cards SET active=0 WHERE user_id=?;', [id]);
      // current PIN OFF (keep pointer linked)
      await conn.query(`
        UPDATE pins p
        JOIN users u ON u.current_pin_id = p.id
        SET p.active = 0
        WHERE u.id = ?;
      `, [id]);
    }

    if (isActivating) {
      // all cards ON
      await conn.query('UPDATE rfid_cards SET active=1 WHERE user_id=?;', [id]);
      // current PIN ON (if any)
      await conn.query(`
        UPDATE pins p
        JOIN users u ON u.current_pin_id = p.id
        SET p.active = 1
        WHERE u.id = ?;
      `, [id]);
    }

    // 3) if request explicitly changed current_pin_id, align that pin with user's active state
    if (req.body.current_pin_id !== undefined && req.body.current_pin_id !== null) {
      const [[user]] = await conn.query('SELECT active FROM users WHERE id=? LIMIT 1;', [id]);
      const pinShouldBe = user?.active ? 1 : 0;
      await conn.query('UPDATE pins SET active=? WHERE id=?;', [pinShouldBe, req.body.current_pin_id]);
    }

    await conn.commit();

    const [rows] = await gatekeeperDb.query(
      'SELECT id, full_name, active, current_pin_id, created_at FROM users WHERE id=?;',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) {
    await conn.rollback();
    console.error('[users.patch] error:', e);
    res.status(500).json({ error: 'db_error' });
  } finally {
    conn.release();
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  await gatekeeperDb.query('DELETE FROM users WHERE id=?;', [id]);
  res.json({ ok: true });
});

/* Events  */
app.get('/api/admin/events', async (req, res) => {
  const { result, credential_type, from, to } = req.query;
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;

  const where = [];
  const params = [];
  if (result)          { where.push('result = ?');          params.push(result); }
  if (credential_type) { where.push('credential_type = ?'); params.push(credential_type); }
  if (from)            { where.push('ts >= ?');             params.push(from); }
  if (to)              { where.push('ts <= ?');             params.push(to); }

  const sql =
    'SELECT id, ts, door_id, user_id, credential_type, presented_uid, result, reason ' +
    'FROM events ' + (where.length ? `WHERE ${where.join(' AND ')} ` : '') +
    'ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const [rows] = await gatekeeperDb.query(sql, params);
  res.json(rows);
});

/* Doors  */
const ACCESS_MODES = new Set(['RFID_OR_PIN', 'RFID_AND_PIN']);

app.get('/api/admin/doors', async (_req, res) => {
  try {
    const [rows] = await gatekeeperDb.query(`
      SELECT id, door_key, name, location, access_mode, open_time_s, active, last_seen_ts
      FROM doors
      ORDER BY id DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/doors', async (req, res) => {
  try {
    const { door_key, name = null, location = null, access_mode = 'RFID_OR_PIN', open_time_s = 5, active = 1 } = req.body || {};
    if (!door_key || typeof door_key !== 'string') return res.status(400).json({ error: 'door_key_required' });
    if (!ACCESS_MODES.has(access_mode)) return res.status(400).json({ error: 'bad_access_mode' });

    const secs = Number(open_time_s);
    if (!Number.isInteger(secs) || secs < 1 || secs > 60) return res.status(400).json({ error: 'bad_open_time_s' });

    const act = active ? 1 : 0;

    const [result] = await gatekeeperDb.query(
      `INSERT INTO doors (door_key, name, location, access_mode, open_time_s, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [door_key.trim(), name || null, location || null, access_mode, secs, act]
    );

    const [rows] = await gatekeeperDb.query(
      `SELECT id, door_key, name, location, access_mode, open_time_s, active, last_seen_ts
         FROM doors
        WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'door_key_exists' });
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.patch('/api/admin/doors/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

    const setParts = [];
    const params = [];

    if (typeof req.body.door_key === 'string' && req.body.door_key.trim()) {
      setParts.push('door_key=?'); params.push(req.body.door_key.trim());
    }
    if (req.body.name !== undefined)       { setParts.push('name=?');      params.push((req.body.name ?? null) || null); }
    if (req.body.location !== undefined)   { setParts.push('location=?');  params.push((req.body.location ?? null) || null); }
    if (req.body.access_mode !== undefined){
      if (!ACCESS_MODES.has(req.body.access_mode)) return res.status(400).json({ error: 'bad_access_mode' });
      setParts.push('access_mode=?'); params.push(req.body.access_mode);
    }
    if (req.body.open_time_s !== undefined){
      const secs = Number(req.body.open_time_s);
      if (!Number.isInteger(secs) || secs < 1 || secs > 60) return res.status(400).json({ error: 'bad_open_time_s' });
      setParts.push('open_time_s=?'); params.push(secs);
    }
    if (req.body.active !== undefined)     { setParts.push('active=?');    params.push(req.body.active ? 1 : 0); }

    if (!setParts.length) return res.status(400).json({ error: 'no_fields' });

    params.push(id);
    await gatekeeperDb.query(`UPDATE doors SET ${setParts.join(', ')} WHERE id=?`, params);

    const [rows] = await gatekeeperDb.query(
      `SELECT id, door_key, name, location, access_mode, open_time_s, active, last_seen_ts
         FROM doors WHERE id=?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'door_key_exists' });
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.delete('/api/admin/doors/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    await gatekeeperDb.query('DELETE FROM doors WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

/* MQTT & Events  */
const mqttUrl = process.env.MQTT_URL || 'mqtt://172.31.0.137:1883';
const mqttClientId = process.env.MQTT_CLIENT_ID || 'gatekeeper-api';
const defaultDoorId = Number(process.env.DOOR_ID || NaN);
const mqttTopicBase = process.env.MQTT_TOPIC_BASE || 'doors';

const CREDENTIAL = { RFID: 'RFID', PIN: 'PIN', UNKNOWN: 'UNKNOWN' };
const EVENT_RESULT = { GRANTED: 'granted', DENIED: 'denied' };

//In memory cache for door lookups
const doorKeyToIdCache = new Map();

async function resolveDoorIdByKey(door_key) {
  if (!door_key) return Number.isFinite(defaultDoorId) ? defaultDoorId : null;
  if (doorKeyToIdCache.has(door_key)) return doorKeyToIdCache.get(door_key);
  const [rows] = await gatekeeperDb.query(
    'SELECT id FROM doors WHERE door_key=? AND active=1 LIMIT 1',
    [door_key]
  );
  const id = rows.length ? rows[0].id : null;
  doorKeyToIdCache.set(door_key, id);
  return id;
}

async function checkDoorUserAccess(door_id, user_id) {
  if (!door_id || !user_id) return false;
  const [rows] = await gatekeeperDb.query(
    'SELECT allowed FROM door_access WHERE door_id=? AND user_id=? LIMIT 1',
    [door_id, user_id]
  );
  return rows.length > 0 && rows[0].allowed === 1;
}

const mqttClient = mqtt.connect(mqttUrl, {
  clientId: mqttClientId,
  clean: true,
  reconnectPeriod: 2000,
  protocolVersion: 5,
});

mqttClient.on('connect', () => {
  console.log('[MQTT] connected:', mqttUrl);
  const topics = [
    'card_input', 'code_input', 'egress_request',
    `${mqttTopicBase}/+/card_input`,
    `${mqttTopicBase}/+/code_input`,
    `${mqttTopicBase}/+/egress_request`,
  ];
  mqttClient.subscribe(topics, { qos: 1 }, (err) => {
    if (err) console.error('[MQTT] subscribe error:', err);
  });
});

mqttClient.on('error', (err) => console.error('[MQTT] error:', err));

async function recordEventAndNotifyDoor({ door_id, door_key, credential_type, presented_uid, user_id, ok, reason }) {
  let eventId = null;

  const resolvedDoorId = Number.isFinite(door_id)
    ? door_id
    : (Number.isFinite(defaultDoorId) ? defaultDoorId : null);

  try {
    if (resolvedDoorId) {
      const [res] = await gatekeeperDb.query(
        `INSERT INTO events (door_id, user_id, credential_type, presented_uid, result, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          resolvedDoorId,
          ok ? (user_id ?? null) : null,
          credential_type,
          presented_uid ?? null,
          ok ? EVENT_RESULT.GRANTED : EVENT_RESULT.DENIED,
          ok ? null : (reason || null),
        ]
      );
      eventId = res.insertId;
    } else {
      console.warn('[MQTT] No door_id available; skipping events insert');
    }
  } catch (e) {
    console.error('[MQTT] insert event error:', e.message || e);
  }

  const resultTopic = ok ? 'access_granted' : 'access_denied';
  const outTopic = door_key ? `${mqttTopicBase}/${door_key}/${resultTopic}` : resultTopic;

  mqttClient.publish(outTopic, '', { qos: 1 }, (err) => {
    if (err) console.error('[MQTT] publish error:', err);
  });

  return eventId;
}

mqttClient.on('message', async (topic, payload) => {
  const text = (payload?.toString() || '').trim();
  if (!text) return;

  let door_key = null;
  let sub = topic;
  const prefix = `${mqttTopicBase}/`;
  if (topic.startsWith(prefix)) {
    const parts = topic.split('/');
    door_key = parts[1] || null;
    sub = parts.slice(2).join('/');
  }

  try {
    if (sub === 'egress_request' || topic === 'egress_request') {
      const door_id = await resolveDoorIdByKey(door_key);
      await recordEventAndNotifyDoor({
        door_id, door_key,
        credential_type: CREDENTIAL.UNKNOWN,
        presented_uid: null,
        user_id: null,
        ok: true,
        reason: 'egress',
      });
      return;
    }

    if (sub === 'card_input' || topic === 'card_input') {
      const door_id = await resolveDoorIdByKey(door_key);
      const [rows] = await gatekeeperDb.query(
        `SELECT u.id AS user_id
           FROM rfid_cards c
           JOIN users u ON u.id = c.user_id
          WHERE c.uid = ? AND c.active = 1 AND u.active = 1
          LIMIT 1`,
        [text]
      );
      if (rows.length) {
        const userId = rows[0].user_id;
        const allowed = await checkDoorUserAccess(door_id, userId);
        if (allowed) {
          await recordEventAndNotifyDoor({ door_id, door_key, credential_type: CREDENTIAL.RFID, presented_uid: text, user_id: userId, ok: true });
        } else {
          await recordEventAndNotifyDoor({ door_id, door_key, credential_type: CREDENTIAL.RFID, presented_uid: text, ok: false, reason: 'no_access_to_door' });
        }
      } else {
        await recordEventAndNotifyDoor({ door_id, door_key, credential_type: CREDENTIAL.RFID, presented_uid: text, ok: false, reason: 'rfid_not_found' });
      }
      return;
    }

    if (sub === 'code_input' || topic === 'code_input') {
      const door_id = await resolveDoorIdByKey(door_key);
      const pin = text;

      const [rows] = await gatekeeperDb.query(
        `SELECT u.id AS user_id, p.pin_hash
           FROM users u
           JOIN pins p ON p.id = u.current_pin_id
          WHERE u.active = 1 AND p.active = 1`
      );

      let matchedUserId = null;
      for (const r of rows) {
        if (bcrypt.compareSync(pin, r.pin_hash)) { matchedUserId = r.user_id; break; }
      }

      let ok = false;
      let reason = 'pin_no_match';
      let userIdForEvent = null;

      if (matchedUserId !== null) {
        const allowed = await checkDoorUserAccess(door_id, matchedUserId);
        if (allowed) {
          ok = true; reason = null; userIdForEvent = matchedUserId;
        } else {
          ok = false; reason = 'no_access_to_door';
        }
      }

      const eventId = await recordEventAndNotifyDoor(
        { door_id, door_key, credential_type: CREDENTIAL.PIN, user_id: userIdForEvent, ok, reason }
      );

      if (eventId) {
        const pinSha = createHash('sha256').update(pin, 'utf8').digest('hex');
        const pinLen = pin.length;
        try {
          await gatekeeperDb.query(
            'UPDATE events SET pin_sha = ?, pin_len = ? WHERE id = ?',
            [pinSha, pinLen, eventId]
          );
        } catch (e) {
          console.error('[PIN_LOG] update error:', e.message || e);
        }
      }
      return;
    }
  } catch (e) {
    console.error('[MQTT] handler error:', e.message || e);
    await recordEventAndNotifyDoor({ credential_type: CREDENTIAL.UNKNOWN, ok: false, reason: 'handler_error' });
  }
});

/*Listen*/
app.listen(PORT, () => {
  console.log(`API listening on http://0.0.0.0:${PORT}`);
});
