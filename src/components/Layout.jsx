import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Bot, Megaphone, PlusCircle, Users, Wand2, Images, Sparkles, MapPin, ShoppingCart, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/create-ad', label: 'Create Ad', icon: PlusCircle },
  { to: '/quick-sales', label: 'Quick Sales', icon: Sparkles },
  { to: '/locations', label: 'Locations', icon: MapPin },
  { to: '/media', label: 'Media', icon: Images },
  { to: '/audiences', label: 'Audiences', icon: Users },
  { to: '/optimizer', label: 'Optimizer', icon: Wand2 },
  { to: '/auto-rules', label: 'Auto Rules', icon: Bot },
  { to: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { to: '/customer-sms', label: 'Customer SMS', icon: MessageSquare },
];

export default function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="w-60 border-r bg-sidebar p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 mb-6">
          <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <p className="font-heading font-semibold leading-none">AdPilot</p>
            <p className="text-xs text-muted-foreground">Meta Ads Control</p>
          </div>
        </div>
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              pathname === to
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}