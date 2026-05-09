import { useState, type ComponentType, type ReactNode } from "react";
import { Link } from "@/lib/router";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type SidebarSectionIcon = ComponentType<{ className?: string }>;

export type SidebarSectionMenuAction =
  | {
      type: "item";
      label: string;
      icon?: SidebarSectionIcon;
      href?: string;
      onSelect?: () => void;
    }
  | { type: "separator" };

export type SidebarSectionRadioChoice = {
  label: string;
  value: string;
};

type SidebarSectionMenu = {
  actions?: SidebarSectionMenuAction[];
  ariaLabel?: string;
  radioChoices?: SidebarSectionRadioChoice[];
  radioLabel?: string;
  radioValue?: string;
  onRadioValueChange?: (value: string) => void;
};

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
  collapsible?: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };
  menu?: SidebarSectionMenu;
}

function SidebarSectionHeader({
  collapsible,
  label,
  menu,
}: Pick<SidebarSectionProps, "collapsible" | "label" | "menu">) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = Boolean(menu && ((menu.actions?.length ?? 0) > 0 || (menu.radioChoices?.length ?? 0) > 0));
  const labelClassName = "text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60";
  const caretClassName = cn(
    "h-3 w-3 shrink-0 text-muted-foreground/60 opacity-0 transition-all group-hover/sidebar-section:opacity-100 group-focus-within/sidebar-section:opacity-100",
    collapsible?.open && "rotate-90",
    menuOpen && "opacity-100",
  );

  const labelContent = (
    <>
      {collapsible ? (
        <ChevronRight className={caretClassName} aria-hidden="true" />
      ) : (
        <span className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      <span className={labelClassName}>{label}</span>
    </>
  );

  return (
    <div className="group/sidebar-section flex items-center px-3 py-1.5">
      {collapsible ? (
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
          {labelContent}
        </CollapsibleTrigger>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">{labelContent}</div>
      )}

      {hasMenu ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "h-5 w-5 text-muted-foreground/60 transition-opacity hover:text-foreground data-[state=open]:opacity-100",
                "opacity-0 group-hover/sidebar-section:opacity-100 group-focus-within/sidebar-section:opacity-100",
              )}
              aria-label={menu?.ariaLabel ?? `${label} actions`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {menu?.actions?.map((action, index) => {
              if (action.type === "separator") {
                return <DropdownMenuSeparator key={`separator-${index}`} />;
              }
              const Icon = action.icon;
              const content = (
                <>
                  {Icon ? <Icon className="size-4" /> : null}
                  <span>{action.label}</span>
                </>
              );
              if (action.href) {
                return (
                  <DropdownMenuItem key={`${action.label}-${index}`} asChild>
                    <Link to={action.href}>{content}</Link>
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem key={`${action.label}-${index}`} onSelect={action.onSelect}>
                  {content}
                </DropdownMenuItem>
              );
            })}
            {menu?.radioChoices && menu.radioChoices.length > 0 ? (
              <DropdownMenuRadioGroup
                value={menu.radioValue}
                onValueChange={menu.onRadioValueChange}
                aria-label={menu.radioLabel}
              >
                {menu.radioChoices.map((choice) => (
                  <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function SidebarSection({ label, children, collapsible, menu }: SidebarSectionProps) {
  const content = <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>;

  if (collapsible) {
    return (
      <Collapsible open={collapsible.open} onOpenChange={collapsible.onOpenChange}>
        <SidebarSectionHeader label={label} collapsible={collapsible} menu={menu} />
        <CollapsibleContent>{content}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div>
      <SidebarSectionHeader label={label} menu={menu} />
      {content}
    </div>
  );
}
