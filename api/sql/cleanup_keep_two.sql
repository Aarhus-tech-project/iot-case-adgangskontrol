USE gatekeeper;

SET @keep1 := (SELECT u.id FROM users u JOIN rfid_cards c ON c.user_id=u.id WHERE c.uid='2032142525' LIMIT 1);
SET @keep2 := (SELECT u.id FROM users u JOIN rfid_cards c ON c.user_id=u.id WHERE c.uid='131108166244' LIMIT 1);

SET @kcount := ( ( @keep1 IS NOT NULL ) + ( @keep2 IS NOT NULL ) );

UPDATE events
SET user_id = NULL
WHERE @kcount > 0
  AND user_id IS NOT NULL
  AND user_id NOT IN (IFNULL(@keep1,-1), IFNULL(@keep2,-1));

DELETE FROM users
WHERE @kcount > 0
  AND id NOT IN (IFNULL(@keep1,-1), IFNULL(@keep2,-1));

DELETE c FROM rfid_cards c
LEFT JOIN users u ON u.id=c.user_id
WHERE @kcount > 0 AND u.id IS NULL;

DELETE p FROM pins p
LEFT JOIN users u ON u.id=p.user_id
WHERE @kcount > 0 AND u.id IS NULL;

SELECT u.id, u.full_name, c.uid AS card_uid
FROM users u
LEFT JOIN rfid_cards c ON c.user_id=u.id
ORDER BY u.id;
