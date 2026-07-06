import React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Grade from "./pages/Grade";
import Summary from "./pages/Summary";
import PointsGrade from "./pages/PointsGrade";
import SecurityGate from "./components/SecurityGate";
import "./App.css";

export default function App() {
  return (
    <SecurityGate>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/grade/:sessionId" element={<Grade />} />
          <Route path="/summary/:sessionId" element={<Summary />} />
          <Route path="/points/:sessionId" element={<PointsGrade />} />
        </Routes>
      </HashRouter>
    </SecurityGate>
  );
}
