export type User = {
    id: number;
    full_name: string;
    active: 0 | 1;
    created_at: string;
    current_pin_id: number | null;
};

export type NewUser = {
    full_name: string;
    active?: 0 | 1;
};

export type UpdateUser = Partial<
    Pick<User, "full_name" | "active" | "current_pin_id">
>;

// doors
export type AccessMode = "RFID_OR_PIN" | "RFID_AND_PIN";

export type Door =
    {
        id: number;
        door_key: string;
        name: string | null;
        location: string | null;
        access_mode: AccessMode;
        open_time_s: number;
        active: 0 | 1;
        last_seen_ts: string | null;
    };

// events
export type CredentialType = "RFID" | "PIN" | "RFID+PIN" | "UNKNOWN";
export type EventResult = "granted" | "denied" | "alarm";

export type EventRow =
    {
        id: number;
        ts: string;
        door_id: number | null;
        user_id: number | null;
        credential_type: CredentialType;
        presented_uid: string | null;
        result: EventResult;
        reason: string | null;
        pin_len?: number | null;
        pin_sha?: string | null;
    };
