USE gatekeeper;

CREATE TABLE IF NOT EXISTS pin_attempts (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  ts        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_id  BIGINT NULL,
  door_id   INT NULL,
  user_id   INT NULL,
  pin_hmac  BINARY(32) NOT NULL,
  pin_len   TINYINT UNSIGNED NOT NULL,
  result    ENUM('granted','denied','alarm') NOT NULL,
  reason    VARCHAR(64) NULL,

  CONSTRAINT fk_pin_attempts_event  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT fk_pin_attempts_door   FOREIGN KEY (door_id)  REFERENCES doors(id)  ON DELETE SET NULL,
  CONSTRAINT fk_pin_attempts_user   FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL,

  INDEX (ts),
  INDEX (result),
  INDEX (user_id),
  INDEX (door_id),
  INDEX pin_hmac_idx (pin_hmac)
);

