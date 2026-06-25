import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";

interface Props {
  value?: string; // YYYY-MM-DD
  onChange: (iso: string) => void;
}

function isoFromDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

function parseIso(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export function InspectionDateField({ value, onChange }: Props) {
  const today = isoFromDate(new Date());
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <button
        type="button"
        onClick={() => onChange(today)}
        className={
          "rounded-full border px-3 py-1 text-xs transition-colors " +
          (value === today
            ? "bg-orange-500 text-white border-orange-500"
            : "border-white/15 text-white/80 hover:border-orange-400/60")
        }
      >
        Сегодня
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full bg-transparent border-white/15 text-white/80 text-xs"
          >
            <CalendarIcon className="mr-1 h-3.5 w-3.5" />
            {value && value !== today ? value : "Выбрать дату"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parseIso(value)}
            onSelect={(d) => {
              if (d) {
                onChange(isoFromDate(d));
                setOpen(false);
              }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
