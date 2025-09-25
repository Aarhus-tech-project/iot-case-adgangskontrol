import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  IconButton,
  Input,
  InputGroup,
  InputLeftAddon,
  NumberInput,
  NumberInputField,
  Select,
  Spacer,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Text,
  useToast,
} from "@chakra-ui/react";
import {
  AddIcon,
  RepeatIcon,
  EditIcon,
  DeleteIcon,
  CheckIcon,
  CloseIcon,
} from "@chakra-ui/icons";

// How a door looks in the API
type AccessMode = "RFID_OR_PIN" | "RFID_AND_PIN";
type Door = {
  id: number;
  door_key: string;
  name: string | null;
  location: string | null;
  access_mode: AccessMode;
  open_time_s: number;
  active: 0 | 1;
  last_seen_ts: string | null;
};

export default function Doors() {
  const qc = useQueryClient();
  const toast = useToast();

  // Top search box
  const [search, setSearch] = useState("");

  // Create form fields
  const [createKey, setCreateKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createMode, setCreateMode] = useState<AccessMode>("RFID_OR_PIN");
  const [createOpenSeconds, setCreateOpenSeconds] = useState<number>(5);
  const [createActive, setCreateActive] = useState(true);

  // Inline edit state for one row at a time
  const [editId, setEditId] = useState<number | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editMode, setEditMode] = useState<AccessMode>("RFID_OR_PIN");
  const [editOpenSeconds, setEditOpenSeconds] = useState<number>(5);
  const [editActive, setEditActive] = useState<0 | 1>(1);

  // Load doors from the server
  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["doors"],
    queryFn: async () => (await api.get<Door[]>("/doors")).data,
  });

  // Simple client-side filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((d) => {
      if (!q) return true;
      return (
        d.door_key.toLowerCase().includes(q) ||
        (d.name ?? "").toLowerCase().includes(q) ||
        (d.location ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search]);

  // Create a door
  const createDoor = useMutation({
    mutationFn: async () =>
      (await api.post<Door>("/doors", {
        door_key: createKey.trim(),
        name: createName.trim() || null,
        location: createLocation.trim() || null,
        access_mode: createMode,
        open_time_s: createOpenSeconds,
        active: createActive ? 1 : 0,
      })).data,
    onSuccess: () => {
      // reset the form and refresh list
      setCreateKey("");
      setCreateName("");
      setCreateLocation("");
      setCreateMode("RFID_OR_PIN");
      setCreateOpenSeconds(5);
      setCreateActive(true);
      qc.invalidateQueries({ queryKey: ["doors"] });
      toast({ status: "success", title: "Door created" });
    },
    onError: (e: any) =>
      toast({
        status: "error",
        title: "Failed to create door",
        description: e?.response?.data?.error ?? undefined,
      }),
  });

  // Update a door
  const updateDoor = useMutation({
    mutationFn: async (id: number) =>
      (await api.patch<Door>(`/doors/${id}`, {
        door_key: editKey.trim(),
        name: editName.trim() || null,
        location: editLocation.trim() || null,
        access_mode: editMode,
        open_time_s: editOpenSeconds,
        active: editActive,
      })).data,
    onSuccess: () => {
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["doors"] });
      toast({ status: "success", title: "Door updated" });
    },
    onError: (e: any) =>
      toast({
        status: "error",
        title: "Failed to update door",
        description: e?.response?.data?.error ?? undefined,
      }),
  });

  // Delete a door
  const deleteDoor = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/doors/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doors"] });
      toast({ status: "success", title: "Door deleted" });
    },
    onError: () => toast({ status: "error", title: "Failed to delete door" }),
  });

  // Enter edit mode for a row
  function startEdit(d: Door) {
    setEditId(d.id);
    setEditKey(d.door_key);
    setEditName(d.name ?? "");
    setEditLocation(d.location ?? "");
    setEditMode(d.access_mode);
    setEditOpenSeconds(d.open_time_s);
    setEditActive(d.active);
  }

  return (
    <Box>
      {/* Header: title, manual refresh, search */}
      <HStack mb={4} align="center">
        <Heading size="md">Doors</Heading>
        <IconButton
          aria-label="Refresh"
          icon={<RepeatIcon />}
          onClick={() => refetch()}
          isLoading={isFetching}
          variant="ghost"
        />
        <Spacer />
        <Input
          placeholder="Search key, name, or location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxW="320px"
        />
      </HStack>

      {/* Create new door */}
      <HStack mb={6} spacing={3} align="end" flexWrap="wrap">
        <Box minW="220px">
          <Text fontSize="xs" mb={1} color="gray.500">Door key *</Text>
          <Input
            placeholder="unique-key"
            value={createKey}
            onChange={(e) => setCreateKey(e.target.value)}
          />
        </Box>
        <Box minW="220px">
          <Text fontSize="xs" mb={1} color="gray.500">Name</Text>
          <Input
            placeholder="Front Door"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
          />
        </Box>
        <Box minW="220px">
          <Text fontSize="xs" mb={1} color="gray.500">Location</Text>
          <Input
            placeholder="Lobby"
            value={createLocation}
            onChange={(e) => setCreateLocation(e.target.value)}
          />
        </Box>
        <Box minW="220px">
          <Text fontSize="xs" mb={1} color="gray.500">Access mode</Text>
          <Select
            value={createMode}
            onChange={(e) => setCreateMode(e.target.value as AccessMode)}
          >
            <option value="RFID_OR_PIN">RFID_OR_PIN</option>
            <option value="RFID_AND_PIN">RFID_AND_PIN</option>
          </Select>
        </Box>
        <Box minW="180px">
          <Text fontSize="xs" mb={1} color="gray.500">Open time</Text>
          <InputGroup>
            <InputLeftAddon>sec</InputLeftAddon>
            <NumberInput
              value={createOpenSeconds}
              min={1}
              max={60}
              onChange={(_, n) => setCreateOpenSeconds(n || 1)}
            >
              <NumberInputField />
            </NumberInput>
          </InputGroup>
        </Box>
        <HStack>
          <Text>Active</Text>
          <Switch
            isChecked={createActive}
            onChange={(e) => setCreateActive(e.target.checked)}
          />
        </HStack>
        <Button
          leftIcon={<AddIcon />}
          colorScheme="blue"
          onClick={() => createDoor.mutate()}
          isDisabled={!createKey.trim()}
          isLoading={createDoor.isPending}
        >
          Add door
        </Button>
      </HStack>

      {/* Table: loading → empty → rows */}
      <Table variant="simple" size="sm">
        <Thead>
          <Tr>
            <Th>ID</Th>
            <Th>Key / Name</Th>
            <Th>Location</Th>
            <Th>Mode</Th>
            <Th>Open</Th>
            <Th>Active</Th>
            <Th>Last seen</Th>
            <Th textAlign="right">Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {isLoading ? (
            <Tr><Td colSpan={8}>Loading…</Td></Tr>
          ) : filtered.length === 0 ? (
            <Tr><Td colSpan={8}>No doors found.</Td></Tr>
          ) : (
            filtered.map((d) => (
              <Tr key={d.id}>
                <Td>{d.id}</Td>
                <Td>
                  {editId === d.id ? (
                    <HStack>
                      <Input
                        size="sm"
                        value={editKey}
                        onChange={(e) => setEditKey(e.target.value)}
                        maxW="200px"
                      />
                      <Input
                        size="sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxW="220px"
                        placeholder="Name"
                      />
                    </HStack>
                  ) : (
                    <>
                      <Text as="span" fontWeight="semibold">{d.door_key}</Text>
                      {d.name ? <Text as="span" color="gray.500"> — {d.name}</Text> : null}
                    </>
                  )}
                </Td>
                <Td>
                  {editId === d.id ? (
                    <Input
                      size="sm"
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                    />
                  ) : (
                    d.location ?? "-"
                  )}
                </Td>
                <Td>
                  {editId === d.id ? (
                    <Select
                      size="sm"
                      value={editMode}
                      onChange={(e) => setEditMode(e.target.value as AccessMode)}
                    >
                      <option value="RFID_OR_PIN">RFID_OR_PIN</option>
                      <option value="RFID_AND_PIN">RFID_AND_PIN</option>
                    </Select>
                  ) : (
                    <Badge>{d.access_mode}</Badge>
                  )}
                </Td>
                <Td>
                  {editId === d.id ? (
                    <NumberInput
                      size="sm"
                      value={editOpenSeconds}
                      min={1}
                      max={60}
                      onChange={(_, n) => setEditOpenSeconds(n || 1)}
                    >
                      <NumberInputField />
                    </NumberInput>
                  ) : (
                    <>{d.open_time_s}s</>
                  )}
                </Td>
                <Td>
                  {editId === d.id ? (
                    <Switch
                      isChecked={editActive === 1}
                      onChange={(e) => setEditActive(e.target.checked ? 1 : 0)}
                    />
                  ) : d.active ? (
                    <Badge colorScheme="green">Active</Badge>
                  ) : (
                    <Badge>Inactive</Badge>
                  )}
                </Td>
                <Td>
                  <small>{d.last_seen_ts ? new Date(d.last_seen_ts).toLocaleString() : "-"}</small>
                </Td>
                <Td style={{ textAlign: "right" }}>
                  {editId === d.id ? (
                    <HStack justify="end" spacing={2}>
                      <IconButton
                        aria-label="Cancel"
                        icon={<CloseIcon boxSize={3} />}
                        size="xs"
                        variant="ghost"
                        onClick={() => setEditId(null)}
                      />
                      <IconButton
                        aria-label="Save"
                        icon={<CheckIcon boxSize={3} />}
                        size="xs"
                        colorScheme="blue"
                        onClick={() => updateDoor.mutate(d.id)}
                        isLoading={updateDoor.isPending}
                      />
                    </HStack>
                  ) : (
                    <HStack justify="end" spacing={2}>
                      <IconButton
                        aria-label="Edit"
                        icon={<EditIcon />}
                        size="xs"
                        onClick={() => startEdit(d)}
                      />
                      <IconButton
                        aria-label="Delete"
                        icon={<DeleteIcon />}
                        size="xs"
                        colorScheme="red"
                        variant="outline"
                        onClick={() => deleteDoor.mutate(d.id)}
                        isLoading={deleteDoor.isPending}
                      />
                    </HStack>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </Box>
  );
}
