import { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";
import {
    Box,
    Container,
    Flex,
    HStack,
    Heading,
    Spacer,
    IconButton,
    useColorMode,
    useColorModeValue,
} from "@chakra-ui/react";
import { MoonIcon, SunIcon } from "@chakra-ui/icons";

export default function Shell({ children }: PropsWithChildren) {
    const { colorMode, toggleColorMode } = useColorMode();
    const activeBg = useColorModeValue("gray.100", "gray.700");
    const borderClr = useColorModeValue("gray.200", "gray.700");
    const pageBg = useColorModeValue("gray.50", "gray.900");
    const headerBg = useColorModeValue("white", "gray.800");

    const linkStyle = ({ isActive }: { isActive: boolean }) => ({
        padding: "8px 12px",
        borderRadius: 8,
        fontWeight: isActive ? 700 : 500,
        textDecoration: "none",
        background: isActive ? activeBg : "transparent",
    });

    return (
        <Box minH="100vh" bg={pageBg}>
            <Box
                as="header"
                position="sticky"
                top={0}
                zIndex={10}
                bg={headerBg}
                borderBottom="1px solid"
                borderColor={borderClr}
            >
                <Container maxW="6xl" py={3}>
                    <Flex align="center" gap={4}>
                        <Heading size="md">Gatekeeper Admin</Heading>
                        <HStack as="nav" spacing={1}>
                            <NavLink to="/users" style={linkStyle}>Users</NavLink>
                            <NavLink to="/events" style={linkStyle}>Events</NavLink>
                            <NavLink to="/doors" style={linkStyle}>Doors</NavLink>
                        </HStack>
                        <Spacer />
                        <IconButton
                            aria-label="Toggle theme"
                            size="sm"
                            variant="ghost"
                            onClick={toggleColorMode}
                            icon={colorMode === "light" ? <MoonIcon /> : <SunIcon />}
                        />
                    </Flex>
                </Container>
            </Box>

            <Container maxW="6xl" py={6}>
                {children}
            </Container>
        </Box>
    );
}
