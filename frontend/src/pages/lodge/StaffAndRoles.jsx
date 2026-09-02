import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import IconButton from '../../components/IconButton';
import { EditIcon, TrashIcon } from '../../components/ActionIcons';
import Req from '../../components/RequiredMark';
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

// The staff table's sortable columns. Status is a two-state badge rather than a
// value, so it sorts on the same words the cell shows — active first when the
// column is opened, which is the list a desk usually wants.
const SORT_COLUMNS = {
  name: { label: 'Name', get: (u) => u.name || '' },
  phone: { label: 'Phone', get: (u) => u.phone || '' },
  role: { label: 'Role', get: (u) => u.roleName || '' },
  status: { label: 'Status', get: (u) => (u.isActive ? 'Active' : 'Disabled') },
};

// Compared with localeCompare rather than < so "Staff 10" sorts after "Staff 9"
// instead of before it, and so a phone column of numeric strings orders the way
// the digits read.
function compareValues(a, b) {
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' });
}

// A staff phone is an Indian mobile number: exactly ten digits, nothing else.
// Non-digits are dropped and the eleventh digit is refused as they are typed,
// so the field can only ever hold a number of the right shape rather than
// taking anything and rejecting it at save time. Separators aren't allowed
// either — with a fixed ten-digit number there is nothing left to separate.
const PHONE_MAX = 10;
const PHONE_TEN = /^\d{10}$/;

export default function StaffAndRoles() {
  const token = getSession()?.token;

  const [tab, setTab] = useUrlState('tab', 'staff');
  // A ?tab= this screen doesn't own falls back to the first tab rather than
  // matching nothing and rendering an empty page under an unselected strip.
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'staff';
  const [staff, setStaff] = useState(() => readCache('/staff'));
  const [roles, setRoles] = useState(() => readCache('/roles'));
  const [catalog, setCatalog] = useState(() => readCache('/roles:permissions') ?? []);
  const [error, setError] = useState('');

  const loadAll = () => {
    Promise.all([apiGet('/staff', { token }), apiGet('/roles', { token })])
      .then(([s, r]) => {
        setStaff(writeCache('/staff', s.staff));
        setRoles(writeCache('/roles', r.roles));
        setCatalog(writeCache('/roles:permissions', r.permissions));
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

  // Opened with no role picked, not with the first role in the list. The list
  // happens to start at Owner, so pre-selecting it hands every new staff member
  // the run of the property unless someone notices and changes it — a default
  // nobody chose, on the one field where the wrong value is the costly one.
  const openCreateStaff = () => {
    setStaffForm(emptyStaffForm);
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
    // The input already refuses anything but ten digits, so this only catches a
    // number left half-typed — but it is what stops a nine-digit number being
    // saved as though it were a phone number.
    if (!PHONE_TEN.test(staffForm.phone.trim())) {
      return setStaffError('Enter a 10-digit mobile number.');
    }
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
  // Which field the error banner is actually about. The banner sits at the top
  // of a form that scrolls, so on its own it says something is wrong without
  // saying where — this marks the field so it can be outlined and scrolled to.
  const [roleInvalid, setRoleInvalid] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const roleNameRef = useRef(null);
  const rolePermsRef = useRef(null);

  const openCreateRole = () => {
    setRoleForm(emptyRoleForm);
    setRoleError('');
    setRoleInvalid('');
    setRoleModal({ mode: 'create' });
  };

  const openEditRole = (role) => {
    setRoleForm({
      name: role.name,
      description: role.description || '',
      permissions: [...role.permissions],
    });
    setRoleError('');
    setRoleInvalid('');
    setRoleModal({ mode: 'edit', role });
  };

  const closeRoleModal = () => {
    if (roleBusy) return;
    setRoleModal(null);
  };

  const toggleRolePermission = (key) => {
    // Ticking anything answers the "pick at least one" complaint, so the
    // outline comes off as the box is ticked rather than at the next save.
    if (roleInvalid === 'permissions') {
      setRoleInvalid('');
      setRoleError('');
    }
    setRoleForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  };

  // Sends the eye to the field the banner is complaining about. The role modal
  // scrolls, so the field named by an error is often off-screen when the banner
  // appears at the top of it.
  const focusRoleField = (field) => {
    const el = field === 'name' ? roleNameRef.current : rolePermsRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // The permission group has no control of its own to focus, so the first
    // checkbox in it takes the focus and the keyboard lands where the fix is.
    const target = field === 'name' ? el : el.querySelector('input');
    if (target) target.focus({ preventScroll: true });
  };

  const handleSaveRole = async (e) => {
    e.preventDefault();
    setRoleError('');
    setRoleInvalid('');
    if (!roleForm.name.trim()) {
      setRoleError('Enter a role name.');
      setRoleInvalid('name');
      focusRoleField('name');
      return;
    }
    // A role with nothing ticked grants nothing — anyone assigned to it signs in
    // to an empty app. Saving one looks like it worked and fails later at the
    // desk, so it is stopped here instead.
    if (roleForm.permissions.length === 0) {
      setRoleError('Select at least one access for this role.');
      setRoleInvalid('permissions');
      focusRoleField('permissions');
      return;
    }

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

  // ---- Staff sorting ----
  // In the query string alongside the tab, for the same reason the tab is: a
  // staff list ordered by role and then refreshed should come back ordered by
  // role. Held as one 'key:dir' param so the two halves of one setting can
  // never be half-applied by a hand-trimmed link.
  const [sortParam, setSortParam] = useUrlState('sort', '');
  const [sortKeyRaw, sortDirRaw] = String(sortParam).split(':');
  // An unknown column falls back to the server's order rather than to an
  // arbitrary column — a stale link should show the staff list, not a cut of it
  // nobody asked for.
  const sortKey = SORT_COLUMNS[sortKeyRaw] ? sortKeyRaw : null;
  const sortDir = sortDirRaw === 'desc' ? 'desc' : 'asc';

  // First click sorts ascending, second reverses, third clears back to the
  // list's own order — so the header that applied a sort is also the way out
  // of it.
  const toggleSort = (key) => {
    if (sortKey !== key) setSortParam(`${key}:asc`);
    else if (sortDir === 'asc') setSortParam(`${key}:desc`);
    else setSortParam('');
  };

  const sortedStaff = sortKey && staff
    ? [...staff].sort((a, b) => {
        const cmp = compareValues(SORT_COLUMNS[sortKey].get(a), SORT_COLUMNS[sortKey].get(b));
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : staff;

  return (
    <div className="staff-roles">
      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="subtabs__item"
            aria-current={activeTab === t.key ? 'page' : undefined}
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

      {!error && !loading && activeTab === 'staff' && (
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
                      {/* Each heading is the control that sorts its own column —
                          the place a hand already goes when a list needs
                          reordering, rather than a separate menu naming the
                          columns a second time.

                          aria-sort is on the cell rather than the button so a
                          screen reader announces the order as a property of the
                          column, which is what it is. */}
                      {Object.entries(SORT_COLUMNS).map(([key, col]) => (
                        <th
                          key={key}
                          aria-sort={
                            sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                        >
                          <button
                            type="button"
                            className={`staff-roles__sort${
                              sortKey === key ? ' staff-roles__sort--on' : ''
                            }`}
                            onClick={() => toggleSort(key)}
                            title={
                              sortKey === key
                                ? `Sorted by ${col.label} — click to ${
                                    sortDir === 'asc' ? 'reverse' : 'clear'
                                  }`
                                : `Sort by ${col.label}`
                            }
                          >
                            {col.label}
                            {/* Both arrows always, the active one filled: a
                                single arrow that appears on sort makes the
                                heading jump wider the moment it is clicked, and
                                a row of headings that move as you use them is
                                hard to aim at twice. */}
                            <span className="staff-roles__sort-arrows" aria-hidden="true">
                              <span
                                className={`staff-roles__sort-arrow${
                                  sortKey === key && sortDir === 'asc' ? ' staff-roles__sort-arrow--on' : ''
                                }`}
                              >
                                ▲
                              </span>
                              <span
                                className={`staff-roles__sort-arrow${
                                  sortKey === key && sortDir === 'desc' ? ' staff-roles__sort-arrow--on' : ''
                                }`}
                              >
                                ▼
                              </span>
                            </span>
                          </button>
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStaff.map((u) => (
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
                            <IconButton
                              label={`Edit ${u.name}`}
                              icon={<EditIcon />}
                              onClick={() => openEditStaff(u)}
                            />
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
                            {/* Owners can't be disabled from here — the backend
                                refuses the last active owner anyway, and the
                                button only ever offered an error. */}
                            {u.roleKey !== 'OWNER' && (
                              <button
                                type="button"
                                className="chart-row__link-btn chart-row__link-btn--danger"
                                onClick={() => toggleStaffActive(u)}
                              >
                                {u.isActive ? 'Disable' : 'Enable'}
                              </button>
                            )}
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

      {!error && !loading && activeTab === 'roles' && (
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
                  <IconButton
                    label={`Edit access for ${role.name}`}
                    icon={<EditIcon />}
                    onClick={() => openEditRole(role)}
                  />
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
                    <IconButton
                      label={`Delete ${role.name}`}
                      icon={<TrashIcon />}
                      tone="danger"
                      onClick={() => {
                        setDeleteRoleTarget(role);
                        setDeleteRoleError('');
                      }}
                    />
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
          <div
            className="glass-panel staff-roles__modal modal-form__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleSaveStaff} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>{staffModal.mode === 'create' ? 'Add staff' : 'Edit staff'}</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={closeStaffModal}
                    disabled={staffBusy}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">
                  {staffModal.mode === 'create'
                    ? 'They sign in with their phone number and the temporary password you set here.'
                    : 'Their details and what they can reach. Changing the role changes it immediately.'}
                </p>
              </div>

              <div className="modal-form__body">
              {staffError && <div className="form-banner form-banner--error">{staffError}</div>}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="staffName">
                    Name
                    <Req />
                  </label>
                  <input
                    id="staffName"
                    value={staffForm.name}
                    onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="staffPhone">
                    Phone
                    <Req />
                  </label>
                  <input
                    id="staffPhone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={PHONE_MAX}
                    value={staffForm.phone}
                    onChange={(e) =>
                      setStaffForm((f) => ({
                        ...f,
                        // Sliced after stripping, not before: pasting a number
                        // written with spaces or a +91 should keep its ten
                        // digits rather than losing the last few to characters
                        // that were never going to be stored.
                        phone: e.target.value.replace(/\D/g, '').slice(0, PHONE_MAX),
                      }))
                    }
                    placeholder="9876543210"
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
                  <label htmlFor="staffRole">
                    Role
                    <Req />
                  </label>
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
                  <label htmlFor="staffPassword">
                    Temporary password
                    {/* Only rendered while creating, which is exactly when the
                        submit refuses a blank or short one. */}
                    <Req />
                  </label>
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
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__summary">
                  <span className="modal-form__summary-label">
                    {staffForm.name.trim() || 'New staff member'}
                  </span>
                  <span className="modal-form__summary-value modal-form__summary-value--text">
                    {roles.find((r) => r.roleKey === staffForm.roleKey)?.name || 'No role yet'}
                  </span>
                </div>
                <div className="modal-form__foot-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeStaffModal}
                    disabled={staffBusy}
                  >
                    Cancel
                  </button>
                  <button className="btn-accent" type="submit" disabled={staffBusy}>
                    {staffBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password */}
      {pwUser && (
        <div className="glass-backdrop staff-roles__backdrop" onClick={() => !pwBusy && setPwUser(null)}>
          <div
            className="glass-panel staff-roles__modal modal-form__panel"
            onClick={(e) => e.stopPropagation()}
          >
            {pwDone ? (
              <div className="modal-form">
                <div className="modal-form__head">
                  <div className="modal-form__head-row">
                    <h3>Reset password</h3>
                    <button
                      type="button"
                      className="modal-form__close"
                      onClick={() => setPwUser(null)}
                      aria-label="Close"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="modal-form__body">
                  <div className="form-banner form-banner--info">
                    Done. {pwUser.name} can sign in with this password and will be asked to change it.
                  </div>
                </div>
                <div className="modal-form__foot">
                  <div className="modal-form__foot-actions">
                    <button type="button" className="btn-accent" onClick={() => setPwUser(null)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <form className="modal-form" onSubmit={handleResetPassword} noValidate>
                <div className="modal-form__head">
                  <div className="modal-form__head-row">
                    <h3>Reset password</h3>
                    <button
                      type="button"
                      className="modal-form__close"
                      onClick={() => setPwUser(null)}
                      disabled={pwBusy}
                      aria-label="Close"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                  <p className="modal-form__sub">
                    Sets a password for {pwUser.name} to sign in with once. They are asked to choose
                    their own straight after.
                  </p>
                </div>

                <div className="modal-form__body">
                {pwError && <div className="form-banner form-banner--error">{pwError}</div>}
                <div className="field">
                  <label htmlFor="pwValue">
                    Temporary password for {pwUser.name}
                    <Req />
                  </label>
                  <input
                    id="pwValue"
                    type="text"
                    value={pwValue}
                    onChange={(e) => setPwValue(e.target.value)}
                    placeholder="At least 8 characters"
                    autoFocus
                  />
                </div>
                </div>

                <div className="modal-form__foot">
                  <div className="modal-form__foot-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPwUser(null)}
                      disabled={pwBusy}
                    >
                      Cancel
                    </button>
                    <button className="btn-accent" type="submit" disabled={pwBusy}>
                      {pwBusy ? 'Saving…' : 'Reset password'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Role create / edit */}
      {roleModal && (
        <div className="glass-backdrop staff-roles__backdrop" onClick={closeRoleModal}>
          <div
            className="glass-panel staff-roles__modal modal-form__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleSaveRole} noValidate>
              {/* The access list is the tall part, so the title and Save are
                  pinned and only the checkboxes scroll. */}
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>{roleModal.mode === 'create' ? 'Add role' : `Edit ${roleModal.role.name}`}</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={closeRoleModal}
                    disabled={roleBusy}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">
                  A job title and what it can reach. Staff are given a role rather than individual
                  permissions, so changing it here changes it for everyone who holds it.
                </p>
              </div>

              <div className="modal-form__body">
              {roleError && (
                <div id="roleFormError" className="form-banner form-banner--error" role="alert">
                  {roleError}
                </div>
              )}

              {roleModal.mode === 'edit' && roleModal.role.isSystem && (
                <div className="form-banner form-banner--info">
                  This is a built-in role. Saving keeps your changes for this lodge only — you can reset it
                  to the default at any time.
                </div>
              )}

              <div className="field">
                <label htmlFor="roleName">
                  Role name
                  <Req />
                </label>
                <input
                  id="roleName"
                  ref={roleNameRef}
                  className={roleInvalid === 'name' ? 'field__control--invalid' : undefined}
                  aria-invalid={roleInvalid === 'name' || undefined}
                  aria-describedby={roleInvalid === 'name' ? 'roleFormError' : undefined}
                  value={roleForm.name}
                  onChange={(e) => {
                    if (roleInvalid === 'name') {
                      setRoleInvalid('');
                      setRoleError('');
                    }
                    setRoleForm((f) => ({ ...f, name: e.target.value }));
                  }}
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
                {/* A group label rather than a label element with no control to
                    point at — the checkboxes below carry their own labels, and
                    the required mark belongs to the group as a whole. */}
                <span className="field__group-label">
                  Access
                  <Req />
                </span>
                <div
                  ref={rolePermsRef}
                  className={`staff-roles__perm-list${
                    roleInvalid === 'permissions' ? ' staff-roles__perm-list--invalid' : ''
                  }`}
                  role="group"
                  aria-label="Access"
                  aria-invalid={roleInvalid === 'permissions' || undefined}
                  aria-describedby={roleInvalid === 'permissions' ? 'roleFormError' : undefined}
                >
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
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__summary">
                  <span className="modal-form__summary-label">
                    {roleForm.name.trim() || 'New role'} · access
                  </span>
                  <span className="modal-form__summary-value">
                    {roleForm.permissions.length}
                    <span className="modal-form__summary-unit"> of {catalog.length}</span>
                  </span>
                </div>
                <div className="modal-form__foot-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeRoleModal}
                    disabled={roleBusy}
                  >
                    Cancel
                  </button>
                  <button className="btn-accent" type="submit" disabled={roleBusy}>
                    {roleBusy ? 'Saving…' : 'Save access'}
                  </button>
                </div>
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
