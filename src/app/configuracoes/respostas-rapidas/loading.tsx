import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return <main className="grid min-h-dvh place-items-center bg-[var(--canvas)]"><Spinner label="Carregando respostas rápidas" /></main>;
}
