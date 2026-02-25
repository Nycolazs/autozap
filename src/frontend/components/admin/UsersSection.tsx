import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  changeAdminPassword,
  changeSellerPassword,
  createSeller,
  listUsers,
  makeSellerAdmin,
  removeSellerOnly,
  removeSellerRoleFromAdmin,
  revertUserToSeller,
} from '@/src/frontend/lib/adminApi';
import type { AdminUser } from '@/src/frontend/types/admin';
import styles from '@/src/frontend/components/admin/admin.module.css';
import {
  formatDateOnly,
  getErrorMessage,
  isUnauthorized,
  parseCompositeId,
} from '@/src/frontend/components/admin/helpers';

type UsersSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

type PasswordTarget = {
  id: string;
  name: string;
};

async function fetchUsersOrThrow(): Promise<AdminUser[]> {
  const users = await listUsers();
  return Array.isArray(users) ? users : [];
}

export function UsersSection({ onToast, onAuthExpired }: UsersSectionProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordTarget, setPasswordTarget] = useState<PasswordTarget | null>(null);
  const [passwordA, setPasswordA] = useState('');
  const [passwordB, setPasswordB] = useState('');

  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((user) => user.isAdmin).length;
    const sellers = users.filter((user) => user.isSeller).length;
    const inactive = users.filter((user) => user.isSeller && !user.sellerActive).length;
    return { total, admins, sellers, inactive };
  }, [users]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await fetchUsersOrThrow());
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao carregar usuarios.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired, onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreateSeller = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(newName || '').trim();
    const password = String(newPassword || '').trim();

    if (!name || !password) {
      onToast('Informe usuario e senha.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      await createSeller({ name, password });
      setNewName('');
      setNewPassword('');
      onToast('Usuario vendedor criado.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao criar vendedor.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [newName, newPassword, onAuthExpired, onToast, refresh]);

  const handlePromoteSeller = useCallback(async (user: AdminUser) => {
    const parsed = parseCompositeId(user.id);
    if (parsed.id == null) {
      onToast('ID do vendedor invalido.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await makeSellerAdmin(parsed.id);
      onToast(`${user.name} promovido para admin.`, 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao promover vendedor.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onAuthExpired, onToast, refresh]);

  const handleRevertToSeller = useCallback(async (user: AdminUser) => {
    setSubmitting(true);
    try {
      const result = await revertUserToSeller(user.name);
      onToast(result.message || `${user.name} agora e apenas vendedor.`, 'success');
      if (result.sessionDestroyed) {
        onAuthExpired();
        return;
      }
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao reverter usuario.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onAuthExpired, onToast, refresh]);

  const handleRemoveSellerRole = useCallback(async (user: AdminUser) => {
    setSubmitting(true);
    try {
      await removeSellerRoleFromAdmin(user.name);
      onToast('Papel de vendedor removido do admin.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao remover papel de vendedor.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onAuthExpired, onToast, refresh]);

  const handleRemoveSellerOnly = useCallback(async (user: AdminUser) => {
    const parsed = parseCompositeId(user.id);
    if (parsed.id == null) {
      onToast('ID do vendedor invalido.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await removeSellerOnly(parsed.id);
      onToast('Vendedor removido.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao remover vendedor.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onAuthExpired, onToast, refresh]);

  const handleChangePassword = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordTarget) return;

    const p1 = String(passwordA || '').trim();
    const p2 = String(passwordB || '').trim();

    if (!p1 || !p2) {
      onToast('Informe e confirme a nova senha.', 'warning');
      return;
    }
    if (p1.length < 4) {
      onToast('A senha deve ter no minimo 4 caracteres.', 'warning');
      return;
    }
    if (p1 !== p2) {
      onToast('As senhas nao conferem.', 'warning');
      return;
    }

    const parsed = parseCompositeId(passwordTarget.id);
    if (parsed.id == null || parsed.type === 'unknown') {
      onToast('Usuario sem ID valido para troca de senha.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (parsed.type === 'admin') {
        await changeAdminPassword(parsed.id, p1);
      } else {
        await changeSellerPassword(parsed.id, p1);
      }
      onToast('Senha alterada com sucesso.', 'success');
      setPasswordTarget(null);
      setPasswordA('');
      setPasswordB('');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao alterar senha.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onAuthExpired, onToast, passwordA, passwordB, passwordTarget, refresh]);

  return (
    <>
      <section className={styles.card}>
        <header className={styles.cardHead}>Novo vendedor</header>
        <div className={styles.cardBody}>
          <form className={styles.row} onSubmit={handleCreateSeller}>
            <div className={styles.col4}>
              <label className={styles.label}>Usuario</label>
              <input className={styles.input} value={newName} onChange={(event) => setNewName(event.target.value)} />
            </div>
            <div className={styles.col4}>
              <label className={styles.label}>Senha</label>
              <input className={styles.input} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </div>
            <div className={styles.col4}>
              <label className={styles.label}>Acao</label>
              <button className={styles.button} type="submit" disabled={submitting}>Criar vendedor</button>
            </div>
          </form>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHead}>Usuarios cadastrados</header>
        <div className={styles.cardBody}>
          {loading ? <div className={styles.muted}>Carregando...</div> : null}
          {!loading && users.length === 0 ? <div className={styles.empty}>Nenhum usuario encontrado.</div> : null}

          {!!users.length ? (
            <>
              <div className={styles.usersSummary}>
                <span className={styles.usersSummaryPill}>Total: <strong>{stats.total}</strong></span>
                <span className={styles.usersSummaryPill}>Admins: <strong>{stats.admins}</strong></span>
                <span className={styles.usersSummaryPill}>Vendedores: <strong>{stats.sellers}</strong></span>
                <span className={styles.usersSummaryPill}>Inativos: <strong>{stats.inactive}</strong></span>
              </div>

              <div className={styles.usersGrid}>
                {users.map((user) => (
                  <article key={user.id} className={styles.userCard}>
                    <div className={styles.userHead}>
                      <div className={styles.userIdentity}>
                        <span className={styles.userAvatar} aria-hidden="true">
                          {(String(user.name || '').trim().charAt(0) || '?').toUpperCase()}
                        </span>
                        <div>
                          <div className={styles.userName}>{user.name}</div>
                          <div className={styles.userMeta}>Criado em: {formatDateOnly(user.created_at)}</div>
                        </div>
                      </div>

                      <div className={styles.badges}>
                        {user.isAdmin ? <span className={`${styles.badge} ${styles.badgeAdmin}`}>Admin</span> : null}
                        {user.isSeller ? <span className={`${styles.badge} ${styles.badgeSeller}`}>Vendedor</span> : null}
                        {user.isSeller && !user.sellerActive ? <span className={`${styles.badge} ${styles.badgeDisabled}`}>Inativo</span> : null}
                      </div>
                    </div>

                    <div className={styles.userActions}>
                      <button
                        type="button"
                        className={`${styles.buttonSecondary} ${styles.userActionButton}`}
                        onClick={() => setPasswordTarget({ id: user.id, name: user.name })}
                        disabled={submitting}
                      >
                        Alterar senha
                      </button>

                      {!user.isAdmin && user.isSeller ? (
                        <button
                          type="button"
                          className={`${styles.button} ${styles.userActionButton}`}
                          onClick={() => void handlePromoteSeller(user)}
                          disabled={submitting}
                        >
                          Fazer admin
                        </button>
                      ) : null}

                      {user.isAdmin ? (
                        <button
                          type="button"
                          className={`${styles.buttonGhost} ${styles.userActionButton} ${styles.userActionWide}`}
                          onClick={() => void handleRevertToSeller(user)}
                          disabled={submitting}
                        >
                          Tornar apenas vendedor
                        </button>
                      ) : null}

                      {user.isAdmin && user.isSeller ? (
                        <button
                          type="button"
                          className={`${styles.buttonDanger} ${styles.userActionButton} ${styles.userActionWide}`}
                          onClick={() => void handleRemoveSellerRole(user)}
                          disabled={submitting}
                        >
                          Remover papel vendedor
                        </button>
                      ) : null}

                      {!user.isAdmin && user.isSeller ? (
                        <button
                          type="button"
                          className={`${styles.buttonDanger} ${styles.userActionButton} ${styles.userActionWide}`}
                          onClick={() => void handleRemoveSellerOnly(user)}
                          disabled={submitting}
                        >
                          Remover vendedor
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </section>

      {passwordTarget ? (
        <section className={styles.card}>
          <header className={styles.cardHead}>Alterar senha - {passwordTarget.name}</header>
          <div className={styles.cardBody}>
            <form className={styles.row} onSubmit={handleChangePassword}>
              <div className={styles.col6}>
                <label className={styles.label}>Nova senha</label>
                <input
                  className={styles.input}
                  type="password"
                  value={passwordA}
                  onChange={(event) => setPasswordA(event.target.value)}
                />
              </div>
              <div className={styles.col6}>
                <label className={styles.label}>Confirmar senha</label>
                <input
                  className={styles.input}
                  type="password"
                  value={passwordB}
                  onChange={(event) => setPasswordB(event.target.value)}
                />
              </div>
              <div className={styles.col12}>
                <div className={styles.inlineActions}>
                  <button type="submit" className={styles.button} disabled={submitting}>Salvar senha</button>
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => {
                      setPasswordTarget(null);
                      setPasswordA('');
                      setPasswordB('');
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      ) : null}
    </>
  );
}
