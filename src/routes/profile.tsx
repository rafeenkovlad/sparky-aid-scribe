import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useToken } from "@/hooks/useThreads";
import {
  getProfile,
  getCompanyProfile,
  updateProfile,
  uploadProfileAvatar,
  deleteProfileAvatar,
  type ProfileResult,
  type CompanyProfileResult,
  type ProfileUpdatePatch,
} from "@/lib/carreports/storageApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft,
  LogOut,
  Loader2,
  UserRound,
  Pencil,
  Camera,
  Trash2,
  X,
  Check,
} from "lucide-react";

const HIDDEN_FIELDS = [
  "id",
  "urlAvatar",
  "isDelete",
  "isDeleted",
  "isVerifyCompany",
  "isVerifyEmail",
  "isVerifyPhone",
  "likeDown",
  "likeUp",
  "mobileJti",
];

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Профиль · Vindiezel ассистент" },
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

type EditableKey =
  | "firstName"
  | "lastName"
  | "middleName"
  | "email"
  | "city"
  | "description"
  | "companyName"
  | "companyInn";

function ProfilePage() {
  const token = useToken();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [company, setCompany] = useState<CompanyProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<EditableKey, string>>({
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    city: "",
    description: "",
    companyName: "",
    companyInn: "",
  });

  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadProfile = () => {
    setLoading(true);
    setError(null);
    setCompany(null);
    return getProfile()
      .then(async (p) => {
        setProfile(p);
        if (p.companyId) {
          try {
            const c = await getCompanyProfile(p.companyId);
            setCompany(c);
          } catch {
            /* ignore */
          }
        }
        return p;
      })
      .catch((e) => {
        setError(e?.message ?? "Не удалось загрузить профиль");
        return null;
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) {
      navigate({ to: "/" });
      return;
    }
    let cancel = false;
    void loadProfile().then((p) => {
      if (cancel || !p) return;
    });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate]);

  const startEdit = () => {
    if (!profile) return;
    setForm({
      firstName: (profile.firstName as string) ?? "",
      lastName: (profile.lastName as string) ?? "",
      middleName: (profile.middleName as string) ?? "",
      email: (profile.email as string) ?? "",
      city: (profile.city as string) ?? "",
      description: (profile.description as string) ?? "",
      companyName: (profile.companyName as string) ?? "",
      companyInn: (profile.companyInn as string) ?? "",
    });
    setEditing(true);
  };

  const buildPatch = (): ProfileUpdatePatch => {
    if (!profile) return {};
    const patch: ProfileUpdatePatch = {};
    const keys: EditableKey[] = [
      "firstName",
      "lastName",
      "middleName",
      "email",
      "city",
      "description",
    ];
    if (profile.role === "company") {
      keys.push("companyName", "companyInn");
    }
    for (const k of keys) {
      const cur = ((profile as Record<string, unknown>)[k] as string | null | undefined) ?? "";
      const next = form[k];
      if (next === cur) continue;
      if (next === "") {
        // Явное стирание → null
        (patch as Record<string, unknown>)[k] = null;
      } else {
        (patch as Record<string, unknown>)[k] = next;
      }
    }
    return patch;
  };

  const saveEdit = async () => {
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateProfile(patch);
      toast.success("Профиль обновлён");
      setEditing(false);
      await loadProfile();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = () => fileRef.current?.click();

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Нужен файл изображения");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Файл больше 25 МБ");
      return;
    }
    setAvatarBusy(true);
    try {
      const url = await uploadProfileAvatar(file);
      await updateProfile({ urlAvatar: url });
      toast.success("Аватар обновлён");
      await loadProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось загрузить аватар");
    } finally {
      setAvatarBusy(false);
    }
  };

  const onRemoveAvatar = async () => {
    if (!profile?.urlAvatar) return;
    setAvatarBusy(true);
    try {
      await deleteProfileAvatar();
      toast.success("Аватар удалён");
      await loadProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить аватар");
    } finally {
      setAvatarBusy(false);
    }
  };

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

  const initials = (profile?.firstName?.[0] ?? "") + (profile?.lastName?.[0] ?? "");

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-white overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-3 border-b border-white/10 bg-zinc-950/95 backdrop-blur">
        <Link to="/" className="inline-flex">
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-base font-medium flex-1">Профиль</h1>
        {profile && !editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={startEdit}
            className="text-white hover:bg-white/10"
          >
            <Pencil className="h-4 w-4 mr-2" /> Редактировать
          </Button>
        )}
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
              <div className="relative">
                <Avatar url={profile.urlAvatar ?? null} initials={initials} />
                <button
                  type="button"
                  onClick={onPickAvatar}
                  disabled={avatarBusy}
                  className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-orange-500 text-white flex items-center justify-center shadow ring-2 ring-zinc-950 hover:bg-orange-400 disabled:opacity-60"
                  title="Сменить аватар"
                >
                  {avatarBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onFileSelected}
                />
              </div>
              <div className="min-w-0 flex-1">
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
              {profile.urlAvatar && !avatarBusy && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRemoveAvatar}
                  className="text-white/60 hover:text-white hover:bg-white/10"
                  title="Удалить аватар"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            {editing ? (
              <EditForm
                form={form}
                setForm={setForm}
                role={profile.role}
                saving={saving}
                onCancel={() => setEditing(false)}
                onSave={saveEdit}
              />
            ) : (
              <>
                <Section title="Все поля профиля">
                  <AllFields
                    data={profile}
                    skip={[
                      ...HIDDEN_FIELDS,
                      ...(profile.role === "specialist"
                        ? ["companyId", "companyName", "companyInn"]
                        : []),
                    ]}
                  />
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
                    <AllFields data={company} skip={HIDDEN_FIELDS} />
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
          </>
        )}
      </div>
    </div>
  );
}

function EditForm({
  form,
  setForm,
  role,
  saving,
  onCancel,
  onSave,
}: {
  form: Record<EditableKey, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<EditableKey, string>>>;
  role: ProfileResult["role"];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (k: EditableKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="rounded-xl bg-white/5 p-4 space-y-4">
      <div className="text-xs text-white/50">
        Пустое поле сотрёт значение в профиле.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Имя">
          <Input value={form.firstName} onChange={set("firstName")} className="bg-black/30 border-white/10 text-white" />
        </Field>
        <Field label="Фамилия">
          <Input value={form.lastName} onChange={set("lastName")} className="bg-black/30 border-white/10 text-white" />
        </Field>
        <Field label="Отчество">
          <Input value={form.middleName} onChange={set("middleName")} className="bg-black/30 border-white/10 text-white" />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={set("email")}
            className="bg-black/30 border-white/10 text-white"
          />
        </Field>
        <Field label="Город">
          <Input value={form.city} onChange={set("city")} className="bg-black/30 border-white/10 text-white" />
        </Field>
        {role === "company" && (
          <>
            <Field label="Название компании">
              <Input
                value={form.companyName}
                onChange={set("companyName")}
                className="bg-black/30 border-white/10 text-white"
              />
            </Field>
            <Field label="ИНН">
              <Input
                value={form.companyInn}
                onChange={set("companyInn")}
                inputMode="numeric"
                className="bg-black/30 border-white/10 text-white"
              />
            </Field>
          </>
        )}
      </div>
      <Field label="О себе">
        <Textarea
          value={form.description}
          onChange={set("description")}
          rows={4}
          className="bg-black/30 border-white/10 text-white resize-y"
        />
      </Field>

      <div className="flex gap-2 justify-end pt-2">
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
          className="text-white hover:bg-white/10"
        >
          <X className="h-4 w-4 mr-2" /> Отмена
        </Button>
        <Button onClick={onSave} disabled={saving} className="bg-orange-500 hover:bg-orange-400 text-white">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
          Сохранить
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-white/60">{label}</Label>
      {children}
    </div>
  );
}

function Avatar({ url, initials }: { url: string | null; initials: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
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

function Row({ label, value, block }: { label: string; value: React.ReactNode; block?: boolean }) {
  if (block) {
    return (
      <div className="px-4 py-3">
        <div className="text-xs text-white/50 pb-1">{label}</div>
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-white/90">
          {value}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="text-xs text-white/50 w-32 shrink-0 pt-0.5 break-words">{label}</div>
      <div className="text-sm flex-1 text-right break-words whitespace-pre-wrap">{value}</div>
    </div>
  );
}

const BLOCK_FIELDS = new Set(["description", "bio", "about", "address", "note", "notes"]);
function isLongText(v: unknown): boolean {
  return typeof v === "string" && (v.length > 60 || v.includes("\n"));
}

const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  email: "Email",
  phone: "Телефон",
  firstName: "Имя",
  lastName: "Фамилия",
  middleName: "Отчество",
  description: "Описание",
  city: "Город",
  role: "Роль",
  urlAvatar: "Аватар",
  companyId: "ID компании",
  companyName: "Компания",
  companyInn: "ИНН",
  createdAt: "Создан",
  updatedAt: "Обновлён",
  emailVerified: "Email подтверждён",
  phoneVerified: "Телефон подтверждён",
  isActive: "Активен",
  isBlocked: "Заблокирован",
  isDeleted: "Удалён",
};

function humanLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-white/30">—</span>;
  }
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number" || typeof value === "string") {
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toLocaleString("ru-RU");
    }
    if (/^https?:\/\//.test(s)) {
      return (
        <a
          href={s}
          target="_blank"
          rel="noreferrer"
          className="text-orange-400 hover:underline break-all"
        >
          {s}
        </a>
      );
    }
    return s;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-white/30">[]</span>;
    return (
      <pre className="text-xs bg-black/30 rounded p-2 overflow-x-auto text-left">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  if (typeof value === "object") {
    return (
      <pre className="text-xs bg-black/30 rounded p-2 overflow-x-auto text-left">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return String(value);
}

function AllFields({
  data,
  skip = [],
}: {
  data: Record<string, unknown>;
  skip?: string[];
}) {
  const skipLower = skip.map((s) => s.toLowerCase());
  const entries = Object.entries(data).filter(([k]) => {
    const kl = k.toLowerCase();
    if (skipLower.includes(kl)) return false;
    if (kl.includes("like")) return false;
    return true;
  });
  const known = Object.keys(FIELD_LABELS);
  entries.sort(([a], [b]) => {
    const ai = known.indexOf(a);
    const bi = known.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  return (
    <>
      {entries.map(([k, v]) => (
        <Row
          key={k}
          label={humanLabel(k)}
          value={formatValue(v)}
          block={BLOCK_FIELDS.has(k) || isLongText(v)}
        />
      ))}
    </>
  );
}
