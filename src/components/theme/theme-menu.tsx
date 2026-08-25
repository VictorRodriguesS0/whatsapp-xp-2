"use client";

import { MonitorCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isThemePreference } from "@/lib/theme";

import { useTheme } from "./theme-provider";

export function ThemeMenu() {
  const { preference, setPreference } = useTheme();
  const handlePreferenceChange = (value: string) => {
    if (isThemePreference(value)) setPreference(value);
  };

  return (
    <TooltipProvider delayDuration={250}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Tema" size="icon" variant="ghost">
                <MonitorCog aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Alterar tema</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" aria-label="Tema">
          <DropdownMenuRadioGroup value={preference} onValueChange={handlePreferenceChange}>
            <DropdownMenuRadioItem value="light">Claro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Escuro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">Seguir o sistema</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
