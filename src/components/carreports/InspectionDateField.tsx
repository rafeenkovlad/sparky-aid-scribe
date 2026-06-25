import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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

  // Auto-fill today on mount if no value
  useEffect(() => {
    if (!value) onChange(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayDate = new Date();
  todayDate.setHours(23, 59, 59, 999);

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full bg-transparent border-white/15 text-white/80 text-xs"
          >
            <CalendarIcon className="mr-1 h-3.5 w-3.5" />
            {value ?? today}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parseIso(value ?? today)}
            onSelect={(d) => {
              if (d) {
                onChange(isoFromDate(d));
                setOpen(false);
              }
            }}
            disabled={(d) => d > todayDate}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
