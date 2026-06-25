import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setToken } from "@/lib/carreports/tokenStore";
import { getProfile } from "@/lib/carreports/storageApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialToken?: string | null;
}

export function TokenDialog({ open, onOpenChange, initialToken }: Props) {
  const [value, setValue] = useState(initialToken ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialToken ?? "");
      setError(null);
      setOkMsg(null);
    }
  }, [open, initialToken]);

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
      setOkMsg(`Подключено как ${profile.firstName ?? profile.email ?? profile.role} (id ${profile.id})`);
      setTimeout(() => onOpenChange(false), 600);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Bearer-токен carreports</DialogTitle>
          <DialogDescription>
            Токен хранится только локально в этом браузере и подставляется в заголовок
            запросов к Storage и AI API.
          </DialogDescription>
        </DialogHeader>
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
          <Button onClick={save} disabled={busy} className="bg-orange-500 hover:bg-orange-600 text-white">
            {busy ? "Проверяю…" : "Сохранить и проверить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
