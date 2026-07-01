import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Phone, PhoneCall, Copy, Check, Loader2 } from "lucide-react";
import { setToken } from "@/lib/carreports/tokenStore";
import { getProfile } from "@/lib/carreports/storageApi";
import {
  authByPhone,
  verifyAuth,
  saveRefreshToken,
  normalizePhone,
  formatPhone,
  type AuthStartResult,
} from "@/lib/carreports/phoneAuth";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialToken?: string | null;
}

export function TokenDialog({ open, onOpenChange, initialToken }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Вход в carreports</DialogTitle>
          <DialogDescription>
            Авторизуйтесь по звонку с телефона или вставьте готовый Bearer-токен.
            Данные хранятся только локально в этом браузере.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={initialToken ? "manual" : "phone"} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="phone">По телефону</TabsTrigger>
            <TabsTrigger value="manual">Токен</TabsTrigger>
          </TabsList>
          <TabsContent value="phone" className="pt-3">
            <PhoneAuthPanel onDone={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="manual" className="pt-3">
            <ManualTokenPanel initialToken={initialToken} onDone={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── Phone auth ────────────────────────────────────────────────────────────

function PhoneAuthPanel({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<AuthStartResult | null>(null);
  const [pollTick, setPollTick] = useState(0); // for UX ("ждём звонок…")
  const [copied, setCopied] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  async function start() {
    setError(null);
    setOkMsg(null);
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError("Введите номер в формате +7XXXXXXXXXX");
      return;
    }
    setBusy(true);
    try {
      const res = await authByPhone(normalized);
      setStarted(res);
      stopRef.current = false;
      pollLoop(res.notificationToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать авторизацию");
    } finally {
      setBusy(false);
    }
  }

  async function pollLoop(notificationToken: string) {
    let tick = 0;
    while (!stopRef.current) {
      await new Promise((r) => setTimeout(r, 3000));
      if (stopRef.current) return;
      tick += 1;
      setPollTick(tick);
      try {
        const v = await verifyAuth(notificationToken);
        if (v.accessToken) {
          stopRef.current = true;
          setToken(v.accessToken);
          if (v.refreshToken) saveRefreshToken(v.refreshToken);
          try {
            const profile = await getProfile();
            setOkMsg(
              `Подключено как ${profile.firstName ?? profile.email ?? profile.role} (id ${profile.id})`,
            );
          } catch {
            setOkMsg("Вход выполнен");
          }
          setTimeout(onDone, 700);
          return;
        }
      } catch {
        // тихо продолжаем — сервер может временно ответить ошибкой
      }
      if (tick > 100) {
        // ~5 минут — прекращаем автоматом
        stopRef.current = true;
        setError("Время ожидания звонка истекло. Попробуйте снова.");
        setStarted(null);
        return;
      }
    }
  }

  function cancel() {
    stopRef.current = true;
    setStarted(null);
    setPollTick(0);
  }

  async function copyPhone() {
    if (!started) return;
    try {
      await navigator.clipboard.writeText("+" + started.callToPhone.replace(/\D/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  if (!started) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ваш номер телефона</label>
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 999 123-45-67"
            inputMode="tel"
            autoComplete="tel"
          />
          <p className="text-xs text-muted-foreground">
            Используйте тот же номер, с которого будете звонить для подтверждения.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            onClick={start}
            disabled={busy}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {busy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Отправляю…</>
            ) : (
              <><Phone className="mr-2 h-4 w-4" />Продолжить</>
            )}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const dialNumber = "+" + started.callToPhone.replace(/\D/g, "");
  const pretty = formatPhone(dialNumber);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-3 text-center">
        <PhoneCall className="mx-auto h-8 w-8 text-orange-500" />
        <div>
          <p className="text-sm text-muted-foreground">
            Позвоните с номера{" "}
            <span className="font-medium text-foreground">
              {started.phone ? formatPhone(started.phone) : "указанного вами"}
            </span>{" "}
            на этот номер:
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <a
              href={`tel:${dialNumber}`}
              className="text-2xl font-semibold tracking-tight text-foreground hover:underline"
            >
              {pretty}
            </a>
            <button
              type="button"
              onClick={copyPhone}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Скопировать номер"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Ждём звонок… {pollTick > 0 && `(проверка ${pollTick})`}
        </p>
        <p className="text-xs text-muted-foreground">
          Достаточно одного гудка — сбросьте вызов после соединения.
        </p>
      </div>
      {okMsg && <p className="text-sm text-emerald-500 text-center">{okMsg}</p>}
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="ghost" onClick={cancel}>Отменить</Button>
      </DialogFooter>
    </div>
  );
}

// ─── Manual token (fallback) ───────────────────────────────────────────────

function ManualTokenPanel({
  initialToken,
  onDone,
}: {
  initialToken?: string | null;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initialToken ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialToken ?? "");
    setError(null);
    setOkMsg(null);
  }, [initialToken]);

  async function save() {
    const v = value.trim();
    if (!v) {
      setError("Введите токен");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    setToken(v);
    try {
      const profile = await getProfile();
      setOkMsg(
        `Подключено как ${profile.firstName ?? profile.email ?? profile.role} (id ${profile.id})`,
      );
      setTimeout(onDone, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить токен");
    } finally {
      setBusy(false);
    }
  }

  function clearToken() {
    setToken(null);
    setValue("");
    setOkMsg(null);
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="eyJ..."
        className="font-mono text-xs min-h-[120px]"
        spellCheck={false}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {okMsg && <p className="text-sm text-emerald-500">{okMsg}</p>}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="ghost" onClick={clearToken} disabled={busy}>
          Очистить
        </Button>
        <Button
          onClick={save}
          disabled={busy}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          {busy ? "Проверяю…" : "Сохранить и проверить"}
        </Button>
      </DialogFooter>
    </div>
  );
}
