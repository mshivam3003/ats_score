import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import AtsScoring from "./pages/AtsScoring";
import JobDiscovery from "./pages/JobDiscovery";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="ats" element={<AtsScoring />} />
        <Route path="jobs" element={<JobDiscovery />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
