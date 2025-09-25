import { Routes, Route, Navigate } from "react-router-dom";
import Users from "./pages/Users";
import Events from "./pages/Events";
import Shell from "./components/Shell";
import Doors from "./pages/Doors";

// app routes
export default function App() {
  return (
    <Shell>
      <Routes>
        {/* default → users */}
        <Route path="/" element={<Navigate to="/users" replace />} />

        {/* sections */}
        <Route path="/users" element={<Users />} />
        <Route path="/events" element={<Events />} />
        <Route path="/doors" element={<Doors />} />
      </Routes>
    </Shell>
  );
}
