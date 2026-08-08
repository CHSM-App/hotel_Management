import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import '../internal/LodgesDashboard.css';
import './forms.css';
import './chartSections.css';
import './RoomsAndRates.css';
import './StaffAndRoles.css';

const TABS = [
  { key: 'staff', label: 'Staff' },
  { key: 'roles', label: 'Roles & access' },
];

const emptyStaffForm = { name: '', phone: '', email: '', roleKey: '', tempPassword: '' };
const emptyRoleForm = { name: '', description: '', permissions: [] };

export default function StaffAndRoles() {
  const token = getSession()?.token;

  const [tab, setTab] = useState('staff');
  const [staff, setStaff] = useState(null);
  const [roles, setRoles] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState('');

  const loadAll = () => {
    Promise.all([apiGet('/staff', { token }), apiGet('/roles', { token })])
      .then(([s, r]) => {
        setStaff(s.staff);
        setRoles(r.roles);
        setCatalog(r.permissions);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load staff and roles.'));
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Staff ----
  const [staffModal, setStaffModal] = useState(null); // { mode: 'create' | 'edit', user }
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [staffError, setStaffError] = useState('');
  const [staffBusy, setStaffBusy] = useState(false);

  const openCreateStaff = () => {
    setStaffForm({ ...emptyStaffForm, roleKey: roles?.[0]?.roleKey || '' });
    setStaffError('');
    setStaffModal({ mode: 'create' });
  };

  const openEditStaff = (user) => {
    setStaffForm({
      name: user.name,
      phone: user.phone,
      email: user.email || '',
      roleKey: user.roleKey,
      tempPassword: '',
    });
    setStaffError('');
    setStaffModal({ mode: 'edit', user });
  };

  const closeStaffModal = () => {
    if (staffBusy) return;
    setStaffModal(null);
  };

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    setStaffError('');
    if (!staffForm.name.trim()) return setStaffError('Enter a name.');
    if (!staffForm.phone.trim()) return setStaffError('Enter a phone number.');
    if (!staffForm.roleKey) return setStaffError('Choose a role.');
    if (staffModal.mode === 'create' && staffForm.tempPassword.length < 8) {
      return setStaffError('Temporary password must be at least 8 characters.');
    }

    setStaffBusy(true);
    try {
      const body = {
        name: staffForm.name.trim(),
        phone: staffForm.phone.trim(),
        email: staffForm.email.trim(),
        roleKey: staffForm.roleKey,
      };
      if (staffModal.mode === 'create') {
        await apiPost('/staff', { ...body, tempPassword: staffForm.tempPassword }, { token });
      } else {
        await apiPatch(`/staff/${staffModal.user.id}`, body, { token });
      }
      setStaffModal(null);
      loadAll();
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : 'Could not save this staff member.');
    } finally {
      setStaffBusy(false);
    }
  };

  const toggleStaffActive = async (user) => {
    setError('');
    try {
      await apiPatch(`/staff/${user.id}`, { isActive: !user.isActive }, { token });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this staff member.');
    }
  };

  // ---- Password reset ----
  const [pwUser, setPwUser] = useState(null);
  const [pwValue, setPwValue] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pwValue.length < 8) return setPwError('Temporary password must be at least 8 characters.');
    setPwBusy(true);
    try {
      await apiPatch(`/staff/${pwUser.id}/password`, { tempPassword: pwValue }, { token });
      setPwDone(true);
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Could not reset the password.');
    } finally {
      setPwBusy(false);
    }
  };

  // ---- Roles ----
  const [roleModal, setRoleModal] = useState(null); // { mode: 'create' | 'edit', role }
  const [roleForm, setRoleForm] = useState(emptyRoleForm);
  const [roleError, setRoleError] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);

  const openCreateRole = () => {
    setRoleForm(emptyRoleForm);
    setRoleError('');
    setRoleModal({ mode: 'create' });
  };

  const openEditRole = (role) => {
    setRoleForm({
      name: role.name,
      description: role.description || '',
      permissions: [...role.permissions],
    });
    setRoleError('');
    setRoleModal({ mode: 'edit', role });
  };

  const closeRoleModal = () => {
    if (roleBusy) return;
    setRoleModal(null);
  };

  const toggleRolePermission = (key) => {
    setRoleForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  };

  const handleSaveRole = async (e) => {
    e.preventDefault();
    setRoleError('');
    if (!roleForm.name.trim()) return setRoleError('Enter a role name.');

    setRoleBusy(true);
    try {
      const body = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim(),
        permissions: roleForm.permissions,
      };
      if (roleModal.mode === 'create') {
        await apiPost('/roles', body, { token });
      } else {
        await apiPatch(`/roles/${roleModal.role.roleKey}`, body, { token });
      }
      setRoleModal(null);
      loadAll();
    } catch (err) {
      setRoleError(err instanceof ApiError ? err.message : 'Could not save this role.');
    } finally {
      setRoleBusy(false);
    }
  };

  const handleResetRole = async (role) => {
    setError('');
    try {
      await apiPatch(`/roles/${role.roleKey}/reset`, {}, { token });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset this role.');
    }
  };

  const [deleteRole, setDeleteRoleTarget] = useState(null);
  const [deleteRoleError, setDeleteRoleError] = useState('');

  const handleDeleteRole = async () => {
    setDeleteRoleError('');
    try {
      await apiDelete(`/roles/${deleteRole.roleKey}`, { token });
      setDeleteRoleTarget(null);
      loadAll();
    } catch (err) {
      setDeleteRoleError(err instanceof ApiError ? err.message : 'Could not delete this role.');
    }
  };

  const labelFor = (key) => catalog.find((p) => p.key === key)?.label || key;
  const loading = !error && (!staff || !roles);

  return (
    <div className="staff-roles">
      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="subtabs__item"
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}
      {loading && (
        <div className="dash-card">
          <div className="dash-state">Loading…</div>
        </div>
      )}

      {!error && !loading && tab === 'staff' && (
        <>
          <div className="staff-roles__toolbar">
            <span className="staff-roles__count">
              {staff.length} staff member{staff.length === 1 ? '' : 's'}
            </span>
            <button type="button" className="btn-accent" onClick={openCreateStaff}>
              + Add staff
            </button>
          </div>

          {staff.length === 0 ? (
            <div className="dash-card">
              <div className="dash-state">No staff logins yet.</div>
            </div>
          ) : (
            <div className="dash-card">
              <div className="dash-table-scroll">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.name}
                          {u.email && <div className="staff-roles__sub">{u.email}</div>}
                        </td>
                        <td>{u.phone}</td>
                        <td>{u.roleName}</td>
                        <td>
                          <span className={`badge ${u.isActive ? 'badge--on' : 'badge--off'}`}>
                            {u.isActive ? 'Active' : 'Disabled'}
                          </span>
                          {u.mustResetPassword && (
                            <div className="staff-roles__sub">Temporary password</div>
                          )}
                        </td>
                        <td>
                          <div className="staff-roles__row-actions">
                            <button type="button" className="chart-row__link-btn" onClick={() => openEditStaff(u)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="chart-row__link-btn"
                              onClick={() => {
                                setPwUser(u);
                                setPwValue('');
                                setPwError('');
                                setPwDone(false);
                              }}
                            >
                              Reset password
                            </button>
                            <button
                              type="button"
                              className="chart-row__link-btn chart-row__link-btn--danger"
                              onClick={() => toggleStaffActive(u)}
                            >
                              {u.isActive ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!error && !loading && tab === 'roles' && (
        <>
          <div className="staff-roles__toolbar">
            <span className="staff-roles__count">
              Built-in roles come preset. Tick extra access to override one, or add your own.
            </span>
            <button type="button" className="btn-accent" onClick={openCreateRole}>
              + Add role
            </button>
          </div>

          <div className="staff-roles__role-grid">
            {roles.map((role) => (
              <div className="staff-roles__role" key={role.roleKey}>
                <div className="staff-roles__role-head">
                  <div>
                    <div className="staff-roles__role-name">
                      {role.name}
                      {role.isSystem ? (
                        <span className="badge badge--off">Built-in</span>
                      ) : (
                        <span className="badge badge--accent">Custom</span>
                      )}
                      {role.isOverridden && <span className="badge badge--on">Customised</span>}
                    </div>
                    {role.description && <p className="staff-roles__role-desc">{role.description}</p>}
                  </div>
                </div>

                <div className="staff-roles__perms">
                  {role.permissions.length === 0 ? (
                    <span className="staff-roles__sub">No access granted yet.</span>
                  ) : (
                    role.permissions.map((p) => (
                      <span className="staff-roles__perm" key={p}>
                        {labelFor(p)}
                      </span>
                    ))
                  )}
                </div>

                <div className="staff-roles__role-actions">
                  <button type="button" className="chart-row__link-btn" onClick={() => openEditRole(role)}>
                    Edit access
                  </button>
                  {role.isOverridden && (
                    <button
                      type="button"
                      className="chart-row__link-btn"
                      onClick={() => handleResetRole(role)}
                    >
                      Reset to default
                    </button>
                  )}
                  {role.isCustom && (
                    <button
                      type="button"
                      className="chart-row__link-btn chart-row__link-btn--danger"
                      onClick={() => {
                        setDeleteRoleTarget(role);
                        setDeleteRoleError('');
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Staff create / edit */}
      {staffModal && (
        <div className="glass-backdrop staff-roles__backdrop" onClick={closeStaffModal}>
          <div className="glass-panel staff-roles__modal" onClick={(e) => e.stopPropagation()}>
            <h3>{staffModal.mode === 'create' ? 'Add staff' : 'Edit staff'}</h3>
            <form onSubmit={handleSaveStaff} noValidate>
              {staffError && <div className="form-banner form-banner--error">{staffError}</div>}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="staffName">Name</label>
                  <input
                    id="staffName"
                    value={staffForm.name}
                    onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="staffPhone">Phone</label>
                  <input
                    id="staffPhone"
                    value={staffForm.phone}
                    onChange={(e) => setStaffForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="staffEmail">Email (optional)</label>
                  <input
                    id="staffEmail"
                    value={staffForm.email}
                    onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="staffRole">Role</label>
                  <select
                    id="staffRole"
                    value={staffForm.roleKey}
                    onChange={(e) => setStaffForm((f) => ({ ...f, roleKey: e.target.value }))}
                  >
                    <option value="">Choose a role</option>
                    {roles.map((r) => (
                      <option key={r.roleKey} value={r.roleKey}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {staffModal.mode === 'create' && (
                <div className="field">
                  <label htmlFor="staffPassword">Temporary password</label>
                  <input
                    id="staffPassword"
                    type="text"
                    value={staffForm.tempPassword}
                    onChange={(e) => setStaffForm((f) => ({ ...f, tempPassword: e.target.value }))}
                    placeholder="At least 8 characters"
                  />
                  <p className="staff-roles__sub">
                    Share this with them — they&apos;ll be asked to set their own after signing in.
                  </p>
                </div>
              )}

              <div className="staff-roles__actions">
                <button type="button" className="btn-secondary" onClick={closeStaffModal} disabled={staffBusy}>
                  Cancel
                </button>
                <button className="btn-accent" type="submit" disabled={staffBusy}>
                  {staffBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password */}
      {pwUser && (
        <div className="glass-backdrop staff-roles__backdrop" onClick={() => !pwBusy && setPwUser(null)}>
          <div className="glass-panel staff-roles__modal" onClick={(e) => e.stopPropagation()}>
            <h3>Reset password</h3>
            {pwDone ? (
              <>
                <div className="form-banner form-banner--info">
                  Done. {pwUser.name} can sign in with this password and will be asked to change it.
                </div>
                <div className="staff-roles__actions">
                  <button type="button" className="btn-accent" onClick={() => setPwUser(null)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleResetPassword} noValidate>
                {pwError && <div className="form-banner form-banner--error">{pwError}</div>}
                <div className="field">
                  <label htmlFor="pwValue">Temporary password for {pwUser.name}</label>
                  <input
                    id="pwValue"
                    type="text"
                    value={pwValue}
                    onChange={(e) => setPwValue(e.target.value)}
                    placeholder="At least 8 characters"
                    autoFocus
                  />
                </div>
                <div className="staff-roles__actions">
                  <button type="button" className="btn-secondary" onClick={() => setPwUser(null)} disabled={pwBusy}>
                    Cancel
                  </button>
                  <button className="btn-accent" type="submit" disabled={pwBusy}>
                    {pwBusy ? 'Saving…' : 'Reset password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Role create / edit */}
      {roleModal && (
        <div className="glass-backdrop staff-roles__backdrop" onClick={closeRoleModal}>
          <div className="glass-panel staff-roles__modal" onClick={(e) => e.stopPropagation()}>
            <h3>{roleModal.mode === 'create' ? 'Add role' : `Edit ${roleModal.role.name}`}</h3>
            <form onSubmit={handleSaveRole} noValidate>
              {roleError && <div className="form-banner form-banner--error">{roleError}</div>}

              {roleModal.mode === 'edit' && roleModal.role.isSystem && (
                <div className="form-banner form-banner--info">
                  This is a built-in role. Saving keeps your changes for this lodge only — you can reset it
                  to the default at any time.
                </div>
              )}

              <div className="field">
                <label htmlFor="roleName">Role name</label>
                <input
                  id="roleName"
                  value={roleForm.name}
                  onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={roleModal.mode === 'edit' && roleModal.role.isSystem}
                  placeholder="Night Manager"
                />
              </div>

              <div className="field">
                <label htmlFor="roleDesc">Description (optional)</label>
                <input
                  id="roleDesc"
                  value={roleForm.description}
                  onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))}
                  disabled={roleModal.mode === 'edit' && roleModal.role.isSystem}
                />
              </div>

              <div className="field">
                <label>Access</label>
                <div className="staff-roles__perm-list">
                  {catalog.map((p) => (
                    <label className="staff-roles__perm-option" key={p.key}>
                      <input
                        type="checkbox"
                        checked={roleForm.permissions.includes(p.key)}
                        onChange={() => toggleRolePermission(p.key)}
                      />
                      <span>
                        <strong>{p.label}</strong>
                        <span className="staff-roles__sub">{p.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="staff-roles__actions">
                <button type="button" className="btn-secondary" onClick={closeRoleModal} disabled={roleBusy}>
                  Cancel
                </button>
                <button className="btn-accent" type="submit" disabled={roleBusy}>
                  {roleBusy ? 'Saving…' : 'Save access'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete role */}
      {deleteRole && (
        <div className="glass-backdrop staff-roles__backdrop" onClick={() => setDeleteRoleTarget(null)}>
          <div className="glass-panel staff-roles__modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {deleteRole.name}</h3>
            <p className="staff-roles__sub">This can&apos;t be undone.</p>
            {deleteRoleError && <div className="form-banner form-banner--error">{deleteRoleError}</div>}
            <div className="staff-roles__actions">
              <button type="button" className="btn-secondary" onClick={() => setDeleteRoleTarget(null)}>
                Cancel
              </button>
              <button type="button" className="btn-accent" onClick={handleDeleteRole}>
                Delete role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
