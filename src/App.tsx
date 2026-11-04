import { Routes, Route } from 'react-router-dom';
import StudentPage from './pages/StudentPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  return (
    <Routes>
      <Route path="/s/:code" element={<StudentPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Message text="Please open the link or scan the QR code your teacher shows." />} />
    </Routes>
  );
}

export function Message({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10 text-center">
      <p className="text-lg">{text}</p>
      {children}
    </main>
  );
}
