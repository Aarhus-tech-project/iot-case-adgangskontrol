import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mysql from 'mysql2/promise';

dotenv.config();

/* Env + DB */
const PORT = process.env.PORT || 3000;

const getDbPass = () => process.env.DB_PASS ?? process.env.DB_PASSWORD ?? '';

const gatekeeperDb = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'doorro',
  password: getDbPass() || 'Datait2025!',
  database: process.env.DB_NAME || 'gatekeeper',
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true,
});

/*  App  */
const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://172.31.0.137:5173',
];

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(morgan('dev'));

/*  Health  */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

/*  Users  */
app.get('/api/admin/users', async (_req, res) => {
  try {
    const [rows] = await gatekeeperDb.query(
      'SELECT id, full_name, active, current_pin_id, created_at FROM users ORDER BY id DESC'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const { full_name, active = 1 } = req.body || {};
    if (!full_name || typeof full_name !== 'string') {
      return res.status(400).json({ error: 'full_name_required' });
    }

    const [result] = await gatekeeperDb.query(
      'INSERT INTO users (full_name, active) VALUES (?, ?)',
      [full_name.trim(), active ? 1 : 0]
    );
    const [rows] = await gatekeeperDb.query(
      'SELECT id, full_name, active, current_pin_id, created_at FROM users WHERE id=?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.patch('/api/admin/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

    const setParts = [];
    const params = [];
    if (typeof req.body.full_name === 'string') {
      setParts.push('full_name=?'); params.push(req.body.full_name.trim());
    }
    if (req.body.active !== undefined) {
      setParts.push('active=?'); params.push(req.body.active ? 1 : 0);
    }
    if (req.body.current_pin_id !== undefined) {
      setParts.push('current_pin_id=?'); params.push(req.body.current_pin_id ?? null);
    }
    if (!setParts.length) return res.status(400).json({ error: 'no_fields' });

    params.push(id);
    await gatekeeperDb.query(`UPDATE users SET ${setParts.join(', ')} WHERE id=?`, params);

    const [rows] = await gatekeeperDb.query(
      'SELECT id, full_name, active, current_pin_id, created_at FROM users WHERE id=?',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    await gatekeeperDb.query('DELETE FROM users WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

/* Events */
app.get('/api/admin/events', async (req, res) => {
  try {
    const { result, credential_type, from, to } = req.query;
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 500) limit = 500;

    const where = [];
    const params = [];
    if (result)          { where.push('result=?');          params.push(result); }
    if (credential_type) { where.push('credential_type=?'); params.push(credential_type); }
    if (from)            { where.push('ts>=?');             params.push(from); }
    if (to)              { where.push('ts<=?');             params.push(to); }

    const sql =
      'SELECT id, ts, door_id, user_id, credential_type, presented_uid, result, reason ' +
      'FROM events ' + (where.length ? `WHERE ${where.join(' AND ')} ` : '') +
      'ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const [rows] = await gatekeeperDb.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

/* Listen  */
app.listen(PORT, () => {
  console.log(`Admin API listening on http://0.0.0.0:${PORT}`);
});
