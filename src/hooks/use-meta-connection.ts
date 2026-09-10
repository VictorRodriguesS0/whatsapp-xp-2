"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { launchEmbeddedSignup, loadEmbeddedSignupSdk, type FacebookSdk } from "@/modules/meta-connection/embedded-signup";
import type { ConnectionAttemptDto, ConnectionAttemptProof, MetaConnectionPublicConfig } from "@/modules/meta-connection/types";

const active = new Set(["WAITING", "EXCHANGING", "VERIFYING"]);
const rank: Record<ConnectionAttemptDto["state"], number> = { WAITING: 0, EXCHANGING: 1, VERIFYING: 2, CONNECTED: 3, CANCELLED: 3, FAILED: 3, EXPIRED: 3 };

export function useMetaConnection(config: MetaConnectionPublicConfig, onRefresh: () => void | Promise<unknown>) {
  const [attempt, setAttempt] = useState<ConnectionAttemptDto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [ready, setReady] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkCount, setCheckCount] = useState(0);
  const [recovering, setRecovering] = useState(config.enabled);
  const proof = useRef<ConnectionAttemptProof | null>(null);
  const sdk = useRef<FacebookSdk | null>(null);
  const dispose = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const checking = useRef(false);
  const currentId = useRef<string | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshedId = useRef<string | null>(null);

  const accept = useCallback((next: ConnectionAttemptDto) => {
    if (!mounted.current || (currentId.current && next.id !== currentId.current)) return;
    setAttempt((previous) => previous?.id === next.id && rank[previous.state] > rank[next.state] ? previous : next);
  }, []);

  const command = useCallback(async (input: Record<string, unknown>) => {
    const response = await fetch("/api/meta-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store" });
    const payload = await response.json() as { attempt?: ConnectionAttemptDto & { nonce?: string }; error?: string };
    if (!response.ok || !payload.attempt || !(payload.attempt.state in rank)) throw new Error(payload.error ?? "Não foi possível consultar a tentativa. Atualize o estado da conexão antes de tentar novamente.");
    accept(payload.attempt);
    return payload.attempt;
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    if (config.enabled) {
      void fetch("/api/meta-connection", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível consultar a tentativa anterior.");
        const payload = await response.json() as { attempt?: ConnectionAttemptDto };
        if (!controller.signal.aborted && !currentId.current && payload.attempt && payload.attempt.state in rank) {
          currentId.current = payload.attempt.id;
          accept(payload.attempt);
        }
      }).catch(() => {
        if (!controller.signal.aborted) setNotice("Não foi possível consultar a tentativa anterior. Atualize a página antes de continuar.");
      }).finally(() => { if (!controller.signal.aborted) setRecovering(false); });
    }
    return () => { mounted.current = false; controller.abort(); dispose.current?.(); };
  }, [config.enabled, accept]);

  const check = useCallback(async (id: string) => {
    if (checking.current) return;
    checking.current = true;
    try { await command({ action: "reconcile", id }); }
    catch (error) { if (mounted.current) setNotice((error as Error).message); }
    finally { checking.current = false; }
  }, [command]);

  useEffect(() => {
    if (!attempt || attempt.state !== "VERIFYING" || checkCount >= 24) return;
    const timer = setTimeout(() => { setCheckCount((value) => value + 1); void check(attempt.id); }, 5_000);
    return () => clearTimeout(timer);
  }, [attempt, checkCount, check]);

  useEffect(() => {
    if (!attempt || !active.has(attempt.state)) return;
    const timer = setTimeout(() => accept({ ...attempt, state: "EXPIRED" }), Math.max(0, Date.parse(attempt.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [attempt, accept]);

  useEffect(() => {
    if (attempt?.state === "CONNECTED" && refreshedId.current !== attempt.id) {
      refreshedId.current = attempt.id;
      dispose.current?.();
      void onRefreshRef.current();
    }
  }, [attempt]);

  async function prepare() {
    if (preparing || recovering) return;
    setPreparing(true); setNotice(null); setReady(false); setLaunched(false); setCheckCount(0);
    dispose.current?.(); proof.current = null;
    try {
      sdk.current = await loadEmbeddedSignupSdk(config);
      currentId.current = null;
      const next = await command({ action: "start" });
      if (!next.nonce) throw new Error("Não foi possível preparar a reconexão.");
      currentId.current = next.id;
      proof.current = { id: next.id, nonce: next.nonce };
      if (mounted.current) setReady(true);
    } catch (error) { if (mounted.current) setNotice((error as Error).message); }
    finally { if (mounted.current) setPreparing(false); }
  }

  function launch() {
    const current = proof.current;
    if (!current || !sdk.current || launched) return;
    setLaunched(true); setNotice(null);
    const send = (input: Record<string, unknown>) => {
      void command({ ...input, ...current }).catch((error: unknown) => { if (mounted.current) setNotice((error as Error).message); });
    };
    try {
      dispose.current = launchEmbeddedSignup(sdk.current, config, {
        onCode: (code) => send({ action: "exchange", code }),
        onEvent: (event) => {
          if (event.kind === "FINISH") { const { kind: _kind, ...assets } = event; send({ action: "finish", ...assets }); }
          else setNotice(event.kind === "CANCEL" ? "A etapa na Meta foi interrompida. Consulte o estado antes de iniciar outro vínculo." : "A Meta não concluiu a etapa. Consulte o estado da conexão e revise o acesso ao aplicativo.");
        },
        onClose: () => setNotice("A janela da Meta foi fechada. Aguarde a confirmação ou consulte o estado da conexão."),
      });
    } catch {
      setNotice("A janela não abriu. Permita pop-ups da Meta neste site e encerre esta tentativa antes de tentar novamente.");
    }
  }

  async function cancel() {
    if (!attempt) return;
    dispose.current?.();
    proof.current = null; setReady(false);
    try { await command({ action: "cancel", id: attempt.id }); setNotice("Tentativa encerrada nesta central. Atualize o estado para conferir se a Meta chegou a concluir o vínculo."); }
    catch (error) { setNotice((error as Error).message); }
  }
  return { attempt, preparing, recovering, ready, launched, notice, pollingPaused: checkCount >= 24, prepare, launch, cancel, check: () => attempt ? check(attempt.id) : Promise.resolve() };
}
