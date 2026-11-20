import GestureDisplay from "./components/Gesture/GestureDisplay";
import AdminSigns from "./components/pages/AdminSigns";
import UsersPage from "./components/pages/UsersPage";
import LoginPage from "./components/pages/LoginPage";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthenticatedLayout from "./components/AuthenticatedLayout";
import "bootstrap/dist/css/bootstrap.min.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";
import type { Language } from "./types/language";
function App() {
  const [activeLanguage, setActiveLanguage] = useState<Language>("English");

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute roles={["STUDENT", "TEACHER", "ADMIN"]}>
              <AuthenticatedLayout
                activeLanguage={activeLanguage}
                onLanguageChange={setActiveLanguage}
              >
                <GestureDisplay activeLanguage={activeLanguage} />
              </AuthenticatedLayout>
            </ProtectedRoute>
          }
        />

        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/admin-signs"
          element={
            <ProtectedRoute roles={["ADMIN", "TEACHER"]}>
              <AuthenticatedLayout
                activeLanguage={activeLanguage}
                onLanguageChange={setActiveLanguage}
              >
                <AdminSigns />
              </AuthenticatedLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <AuthenticatedLayout
                activeLanguage={activeLanguage}
                onLanguageChange={setActiveLanguage}
              >
                <UsersPage />
              </AuthenticatedLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
