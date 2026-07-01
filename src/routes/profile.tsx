import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useToken } from "@/hooks/useThreads";
import {
  getProfile,
  getCompanyProfile,
  type ProfileResult,
  type CompanyProfileResult,
} from "@/lib/carreports/storageApi";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  LogOut,
  Loader2,
  UserRound,
  Mail,
  IdCard,
  Briefcase,
  Building2,
  MapPin,
} from "lucide-react";

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
  const [company, setCompany] = useState<CompanyProfileResult | null>(null);
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
    setCompany(null);
    getProfile()
      .then(async (p) => {
        if (cancel) return;
        setProfile(p);
        if (p.companyId) {
          try {
            const c = await getCompanyProfile(p.companyId);
            if (!cancel) setCompany(c);
          } catch {
            /* ignore company fetch errors */
          }
        }
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
    profile &&
    [profile.firstName, profile.middleName, profile.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

  const initials =
    (profile?.firstName?.[0] ?? "") + (profile?.lastName?.[0] ?? "");

  const companyDisplayName =
    company?.companyName ?? profile?.companyName ?? null;
  const companyDisplayInn = company?.companyInn ?? profile?.companyInn ?? null;
  const companyCity = company?.city ?? null;

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
            <div className="flex items-center gap-4 rounded-xl bg-white/5 p-4">
              <Avatar url={profile.urlAvatar ?? null} initials={initials} />
              <div className="min-w-0">
                <div className="text-lg font-medium truncate">
                  {fullName || profile.email || `ID ${profile.id}`}
                </div>
                {fullName && profile.email && (
                  <div className="text-sm text-white/50 truncate">{profile.email}</div>
                )}
                <div className="text-xs text-white/40 mt-1">
                  {ROLE_LABEL[profile.role] ?? profile.role}
                </div>
              </div>
            </div>

            <Section title="Все поля профиля">
              <AllFields data={profile} skip={["urlAvatar"]} />
            </Section>

            {company && (
              <Section title="Компания">
                {company.urlAvatar && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <img
                      src={company.urlAvatar}
                      alt=""
                      className="h-10 w-10 rounded-lg object-cover bg-white/10"
                    />
                    <div className="text-sm truncate">
                      {company.companyName ?? `ID ${company.id}`}
                    </div>
                  </div>
                )}
                <AllFields data={company} skip={["urlAvatar"]} />
              </Section>
            )}


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

function Avatar({ url, initials }: { url: string | null; initials: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setFailed(true)}
        className="h-16 w-16 rounded-full object-cover bg-white/10"
      />
    );
  }
  return (
    <div className="h-16 w-16 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-lg font-medium uppercase">
      {initials.trim() || <UserRound className="h-7 w-7" />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-1 pb-1 text-xs uppercase tracking-wider text-white/40">{title}</div>
      <div className="rounded-xl bg-white/5 divide-y divide-white/5">{children}</div>
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
