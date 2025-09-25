import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  Input,
  Select,
  Spacer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  IconButton,
  Text,
} from "@chakra-ui/react";
import { RepeatIcon } from "@chakra-ui/icons";

// Shape of an access event from the API
type EventRow = {
  id: number;
  ts: string;
  door_id: number | null;
  user_id: number | null;
  credential_type: "RFID" | "PIN" | "RFID+PIN" | "UNKNOWN";
  presented_uid: string | null;
  result: "granted" | "denied" | "alarm";
  reason: string | null;
};

// Turn <input type="datetime-local"> value into "YYYY-MM-DD HH:mm[:ss]"
function toMySQLDateTime(local: string | undefined) {
  if (!local) return undefined;
  const s = local.trim();
  if (!s) return undefined;
  // if seconds are missing, add ":00"
  const withSeconds = s.includes(":") && s.split(":").length === 2 ? `${s}:00` : s;
  return withSeconds.replace("T", " ");
}

export default function Events() {
  // Filters
  const [result, setResult] = useState<string>("");
  const [cred, setCred] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [limit, setLimit] = useState<number>(100);

  // Fetch events with current filters
  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["events", { result, cred, from, to, limit }],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit };
      if (result) params.result = result;
      if (cred) params.credential_type = cred;
      if (from) params.from = toMySQLDateTime(from)!;
      if (to) params.to = toMySQLDateTime(to)!;
      const res = await api.get<EventRow[]>("/events", { params });
      return res.data;
    },
  });

  const resetFilters = () => {
    setResult("");
    setCred("");
    setFrom("");
    setTo("");
    setLimit(100);
  };

  const ResultBadge = ({ r }: { r: EventRow["result"] }) => {
    const color = r === "granted" ? "green" : r === "denied" ? "red" : "orange";
    return <Badge colorScheme={color}>{r}</Badge>;
  };

  return (
    <Box>
      {/* Header: title and manual refresh */}
      <HStack mb={4} align="center">
        <Heading size="md">Events</Heading>
        <IconButton
          aria-label="Refresh"
          icon={<RepeatIcon />}
          onClick={() => refetch()}
          isLoading={isFetching}
          variant="ghost"
        />
        <Spacer />
      </HStack>

      {/* Filters */}
      <HStack mb={4} spacing={3} align="end" flexWrap="wrap">
        <Box>
          <Text fontSize="xs" mb={1} color="gray.500">Result</Text>
          <Select value={result} onChange={(e) => setResult(e.target.value)} maxW="180px">
            <option value="">All</option>
            <option value="granted">granted</option>
            <option value="denied">denied</option>
            <option value="alarm">alarm</option>
          </Select>
        </Box>
        <Box>
          <Text fontSize="xs" mb={1} color="gray.500">Credential</Text>
          <Select value={cred} onChange={(e) => setCred(e.target.value)} maxW="200px">
            <option value="">All</option>
            <option value="RFID">RFID</option>
            <option value="PIN">PIN</option>
            <option value="RFID+PIN">RFID+PIN</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </Select>
        </Box>
        <Box>
          <Text fontSize="xs" mb={1} color="gray.500">From</Text>
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Box>
        <Box>
          <Text fontSize="xs" mb={1} color="gray.500">To</Text>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </Box>
        <Box>
          <Text fontSize="xs" mb={1} color="gray.500">Limit</Text>
          <Input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            maxW="120px"
          />
        </Box>
        <HStack>
          <Button onClick={() => refetch()} colorScheme="blue" isLoading={isFetching}>
            Apply
          </Button>
          <Button variant="ghost" onClick={resetFilters}>
            Reset
          </Button>
        </HStack>
      </HStack>

      {/* Table: loading → empty → rows */}
      <Table variant="simple" size="sm">
        <Thead>
          <Tr>
            <Th>ID</Th>
            <Th>Time</Th>
            <Th>Credential</Th>
            <Th>UID</Th>
            <Th>User</Th>
            <Th>Result</Th>
            <Th>Reason</Th>
          </Tr>
        </Thead>
        <Tbody>
          {isLoading ? (
            <Tr><Td colSpan={7}>Loading…</Td></Tr>
          ) : data.length === 0 ? (
            <Tr><Td colSpan={7}>No events.</Td></Tr>
          ) : (
            data.map((e) => (
              <Tr key={e.id}>
                <Td>{e.id}</Td>
                <Td><small>{new Date(e.ts).toLocaleString()}</small></Td>
                <Td>{e.credential_type}</Td>
                <Td><code>{e.presented_uid ?? "-"}</code></Td>
                <Td>{e.user_id ?? "-"}</Td>
                <Td><ResultBadge r={e.result} /></Td>
                <Td>{e.reason ?? "-"}</Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </Box>
  );
}
