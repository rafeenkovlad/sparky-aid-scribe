import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useToken } from "@/hooks/useThreads";
import { getProfile, type ProfileResult } from "@/lib/carreports/storageApi";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut, Loader2, UserRound, Mail, IdCard, Briefcase } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Профиль · carreports" },
      { name: "description", content: "Профиль пользователя carreports." },
    ],
  }),
  component: ProfilePage,
});

const ROLE_LABEL: Record<ProfileResult["role"], string> = {
  specialist: "Специалист",
  company: "Компания",
  client: "Клиент",
};

function ProfilePage() {
  const token = useToken();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate({ to: "/" });
      return;
    }
    let cancel = false;
    setLoading(true);
    setError(null);
    getProfile()
      .then((p) => {
        if (!cancel) setProfile(p);
      })
      .catch((e) => {
        if (!cancel) setError(e?.message ?? "Не удалось загрузить профиль");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [token, navigate]);

  const doLogout = () => {
    try {
      localStorage.removeItem("carreports.token");
      localStorage.removeItem("carreports.refreshToken");
    } catch {}
    navigate({ to: "/" });
    setTimeout(() => window.location.reload(), 50);
  };

  const fullName =
    profile && [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();

  return (
    <div className="min-h-dvh bg-zinc-950 text-white">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-3 border-b border-white/10 bg-zinc-950/95 backdrop-blur">
        <Link to="/" className="inline-flex">
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-base font-medium flex-1">Профиль</h1>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-white/60 text-sm py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive-foreground text-sm p-3">
            {error}
          </div>
        )}

        {profile && !loading && (
          <>
            <div className="flex items-center gap-3 rounded-xl bg-white/5 p-4">
              <div className="h-14 w-14 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center">
                <UserRound className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-medium truncate">
                  {fullName || profile.email || `ID ${profile.id}`}
                </div>
                {fullName && profile.email && (
                  <div className="text-sm text-white/50 truncate">{profile.email}</div>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-white/5 divide-y divide-white/5">
              <Row icon={<IdCard className="h-4 w-4" />} label="ID" value={String(profile.id)} />
              <Row icon={<Mail className="h-4 w-4" />} label="Email" value={profile.email ?? "—"} />
              <Row icon={<UserRound className="h-4 w-4" />} label="Имя" value={profile.firstName ?? "—"} />
              <Row icon={<UserRound className="h-4 w-4" />} label="Фамилия" value={profile.lastName ?? "—"} />
              <Row icon={<Briefcase className="h-4 w-4" />} label="Роль" value={ROLE_LABEL[profile.role] ?? profile.role} />
            </div>

            <Button
              variant="ghost"
              onClick={doLogout}
              className="w-full justify-start text-white hover:bg-white/10"
            >
              <LogOut className="h-4 w-4 mr-2" /> Выход из профиля
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="text-white/40">{icon}</div>
      <div className="text-sm text-white/60 w-24">{label}</div>
      <div className="text-sm flex-1 text-right truncate">{value}</div>
    </div>
  );
}
