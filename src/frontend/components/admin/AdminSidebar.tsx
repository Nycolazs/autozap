import type { AdminSectionKey } from '@/src/frontend/types/admin';
import { ThemeToggle } from '@/src/frontend/components/system/ThemeToggle';
import styles from '@/src/frontend/components/admin/admin.module.css';

type SidebarItem = {
  key: AdminSectionKey;
  title: string;
  hint: string;
  icon: string;
};

const ITEMS: SidebarItem[] = [
  { key: 'users', title: 'Usuários e papéis', hint: 'Perfis e permissões', icon: '👥' },
  { key: 'tickets', title: 'Todos os tickets', hint: 'Busca, filtros e atendimento', icon: '🎫' },
  { key: 'blacklist', title: 'Blacklist', hint: 'Contatos bloqueados', icon: '⛔' },
  { key: 'hours', title: 'Horário comercial', hint: 'Agenda e exceções', icon: '🕒' },
  { key: 'welcome', title: 'Boas-vindas', hint: 'Mensagem automática em expediente', icon: '👋' },
  { key: 'await', title: 'Aguardando automático', hint: 'Regra de retorno', icon: '⏳' },
  { key: 'ranking', title: 'Ranking', hint: 'Performance de vendedores', icon: '📈' },
];

type AdminSidebarProps = {
  active: AdminSectionKey;
  onChange: (next: AdminSectionKey) => void;
  onOpenChat: () => void;
  onLogout: () => void;
};

export function AdminSidebar({ active, onChange, onOpenChat, onLogout }: AdminSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandWrap}>
        <div className={styles.brandBadge}>Admin</div>
        <div className={styles.brand}>AutoZap</div>
        <div className={styles.brandSub}>Painel administrativo</div>
      </div>

      <nav className={styles.nav}>
        {ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.navButton} ${active === item.key ? styles.navButtonActive : ''}`}
            onClick={() => onChange(item.key)}
          >
            <span className={styles.navButtonIcon} aria-hidden="true">{item.icon}</span>
            <span className={styles.navButtonText}>
              <span className={styles.navButtonTitle}>{item.title}</span>
              <span className={styles.navButtonHint}>{item.hint}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className={styles.sidebarFooter}>
        <div className={styles.sidebarTheme}>
          <ThemeToggle />
        </div>
        <button type="button" className={styles.sidebarAction} onClick={onOpenChat}>
          Ir para o atendimento
        </button>
        <button type="button" className={styles.sidebarAction} onClick={onLogout}>
          Sair
        </button>
      </div>
    </aside>
  );
}
