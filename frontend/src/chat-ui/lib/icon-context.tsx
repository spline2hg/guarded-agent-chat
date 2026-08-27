import {
  createContext,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  ChevronRight,
  ChevronDown,
  X,
  Copy,
  Dot,
  ArrowUp,
  Search,
  Loader,
  Shield,
  Brain,
  Globe,
  Check,
  Database,
  Zap,
  MessageSquarePlus,
} from "lucide-react";

export interface IconComponentProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export type IconComponent = ComponentType<IconComponentProps>;

export type IconName =
  | "chevron-right" | "chevron-down" | "x" | "copy" | "dot"
  | "arrow-up" | "search" | "loader" | "shield" | "brain"
  | "globe" | "check" | "database" | "zap" | "message-square-plus";

export const defaultIcons: Record<IconName, IconComponent> = {
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "x": X,
  "copy": Copy,
  "dot": Dot,
  "arrow-up": ArrowUp,
  "search": Search,
  "loader": Loader,
  "shield": Shield,
  "brain": Brain,
  "globe": Globe,
  "check": Check,
  "database": Database,
  "zap": Zap,
  "message-square-plus": MessageSquarePlus,
};

const IconContext = createContext<Record<IconName, IconComponent> | null>(null);

/**
 * Returns a single icon component for the given name.
 * Falls back to the default (Lucide) set if no provider is present.
 */
function useIcon(name: IconName): IconComponent {
  const icons = useContext(IconContext);
  return (icons ?? defaultIcons)[name];
}

/**
 * Swap some or all icons for components from another library.
 * Names left out of `icons` keep their default (Lucide) component.
 */
function IconProvider({
  children,
  icons,
}: {
  children: ReactNode;
  icons?: Partial<Record<IconName, IconComponent>>;
}) {
  const value = useMemo(() => ({ ...defaultIcons, ...icons }), [icons]);
  return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}

export { IconProvider, useIcon };
