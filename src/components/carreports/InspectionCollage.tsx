// Коллаж фото раздела + bottom-sheet аннотации одного фото.
// Используется в сообщении ассистента с kind="inspectionCollage" и в карточке
// upload-приглашения kind="inspectionUploadPrompt".

import { useMemo, useRef } from "react";
import { Camera, Image as ImageIcon, Plus, X } from "lucide-react";
import {
  getSection,
  type SectionSnake,
} from "@/lib/carreports/inspectionSections";
import {
  elementStatus,
  getFinding,
  photosForSection,
} from "@/lib/carreports/inspectionState";
import type { InspectionStep } from "@/lib/carreports/types";

type Verdict = "ok" | "minor" | "serious";

// ─── Upload prompt card ────────────────────────────────────────────────────

export function InspectionUploadPrompt(props: {
  sectionSnake: SectionSnake;
  onPick: (files: File[]) => void;
  interactive: boolean;
}) {
  const { sectionSnake, onPick, interactive } = props;
  const section = getSection(sectionSnake);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-3 space-y-2.5">
      <div className="text-sm text-white">
        Раздел <span className="font-medium text-orange-300">«{section?.label ?? sectionSnake}»</span>.
        Загрузите фото элементов — соберём коллаж, на каждом сможете поставить теги и заметку (вручную или ИИ).
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPick(files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPick(files);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2">
        <button
          disabled={!interactive}
          onClick={() => cameraRef.current?.click()}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm py-2.5"
        >
          <Camera className="h-5 w-5" /> Снять
        </button>
        <button
          disabled={!interactive}
          onClick={() => galleryRef.current?.click()}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-sm py-2.5"
        >
          <ImageIcon className="h-5 w-5" /> Из галереи
        </button>
      </div>
    </div>
  );
}

// ─── Collage card ──────────────────────────────────────────────────────────

export function InspectionCollage(props: {
  ins: InspectionStep;
  sectionSnake: SectionSnake;
  interactive: boolean;
  onPick: (files: File[]) => void;
  onOpenPhoto: (photoIdx: number) => void;
  onDeletePhoto?: (photoIdx: number) => void;
}) {
  const { ins, sectionSnake, interactive, onPick, onOpenPhoto, onDeletePhoto } = props;
  const section = getSection(sectionSnake);
  const list = useMemo(() => photosForSection(ins, sectionSnake), [ins, sectionSnake]);
  const moreRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] text-white">
          Коллаж · <span className="text-white/70">{section?.label ?? sectionSnake}</span>
        </div>
        <div className="text-[11px] text-white/45">{list.length} фото</div>
      </div>

      {list.length === 0 && (
        <div className="text-[12px] text-white/55">
          Пока пусто. Добавьте фото — коллаж появится здесь.
        </div>
      )}

      {list.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {list.map(({ idx, photo }) => {
            const elId = photo.elementId;
            const status = elId
              ? elementStatus(ins, sectionSnake, elId)
              : "empty";
            const finding = elId ? getFinding(ins, sectionSnake, elId) : undefined;
            const tagCount =
              (finding?.seriousDamageTagIds?.length ?? 0) +
              (finding?.noSeriousDamageTagIds?.length ?? 0) +
              (finding?.pendingTagNames?.length ?? 0);
            const elLabel = elId
              ? section?.elements.find((e) => e.id === elId)?.label
              : null;
            const dot =
              status === "serious"
                ? "bg-rose-500"
                : status === "minor"
                  ? "bg-amber-500"
                  : status === "ok"
                    ? "bg-emerald-500"
                    : status === "noteOnly"
                      ? "bg-sky-500"
                      : "bg-white/30";
            return (
              <div
                key={`${idx}:${photo.filename}`}
                className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5 group"
              >
                <button
                  type="button"
                  disabled={!interactive}
                  onClick={() => onOpenPhoto(idx)}
                  className="absolute inset-0 w-full h-full"
                  title={elLabel ?? "Без элемента"}
                >
                  {photo.dataUrl ? (
                    <img
                      src={photo.dataUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-white/40 text-xs">
                      нет превью
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
                    <div className="flex items-center gap-1">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
                      <span className="text-[10px] text-white truncate">
                        {elLabel ?? "—"}
                      </span>
                      {tagCount > 0 && (
                        <span className="ml-auto text-[10px] text-white/85">
                          🏷{tagCount}
                        </span>
                      )}
                      {finding?.note && (
                        <span className="text-[10px] text-white/85">📝</span>
                      )}
                    </div>
                  </div>
                </button>
                {interactive && onDeletePhoto && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Удалить это фото?")) onDeletePhoto(idx);
                    }}
                    aria-label="Удалить фото"
                    className="absolute top-1 right-1 z-10 h-5 w-5 rounded-full bg-black/55 hover:bg-rose-500/80 text-white flex items-center justify-center ring-1 ring-white/15 backdrop-blur-md opacity-80 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {interactive && (
            <>
              <input
                ref={moreRef}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) onPick(files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => moreRef.current?.click()}
                className="aspect-square rounded-lg border border-dashed border-white/20 text-white/60 hover:text-white hover:border-white/40 flex flex-col items-center justify-center gap-1 text-[11px]"
              >
                <Plus className="h-6 w-6" />
                Добавить
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Photo annotator was removed — см. ElementFocusCard — теперь это inline-карточка
// experience that replaced it.

