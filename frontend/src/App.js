import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Grade from "./pages/Grade";
import Summary from "./pages/Summary";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/grade/:sessionId" element={<Grade />} />
        <Route path="/summary/:sessionId" element={<Summary />} />
      </Routes>
    </BrowserRouter>
  );
}
