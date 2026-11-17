import GestureDisplay from "./components/Gesture/GestureDisplay";
import AdminSigns from "./components/pages/AdminSigns";
import LoginPage from "./components/pages/LoginPage";
import ProtectedRoute from "./components/ProtectedRoute";
import "bootstrap/dist/css/bootstrap.min.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute roles={["STUDENT", "TEACHER", "ADMIN"]}>
              <GestureDisplay />
            </ProtectedRoute>
          }
        />

        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/admin-signs"
          element={
            <ProtectedRoute roles={["ADMIN", "TEACHER"]}>
              <AdminSigns />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
