import { actions } from "./actions.js";

const deepFreeze = (obj) => {
  Object.keys(obj).forEach((key) => {
    if (
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      !Object.isFrozen(obj[key])
    ) {
      deepFreeze(obj[key]);
    }
  });
  return Object.freeze(obj);
};

const pages = deepFreeze({
  ENROLMENTS: {
    label: "Enrolments",
    icon: "enrolments",
    path: null,
    position: "sidebar",
    sequence: 1,
    actions: [],
    children: {
      DASHBOARD: {
        label: "Dashboard",
        icon: "dashboard",
        path: "/enrolments/dashboard",
        position: "sidebar",
        sequence: 1,
        actions: [actions.VIEW],
        children: {},
      },
      EXPECTED_ENROLMENTS: {
        label: "Expected Enrolments",
        icon: "expected_enrolments",
        path: "/enrolments/expected-enrolments",
        position: "sidebar",
        sequence: 2,
        actions: [
          actions.VIEW,
          actions.EDIT,
          actions.CREATE,
          actions.IMPORT,
          actions.EXPORT,
        ],
        children: {},
      },
      APPOINTMENTS: {
        label: "Appointments",
        icon: "appointments",
        path: "/enrolments/appointments",
        position: "sidebar",
        sequence: 3,
        actions: [
          actions.VIEW,
          actions.EDIT,
          actions.CREATE,
          actions.DELETE,
          actions.IMPORT,
          actions.EXPORT,
        ],
        children: {},
      },
    },
  },
  SUITABILITY_INTERVIEWS: {
    label: "Suitability - Interviews",
    icon: "suitability",
    path: "/suitability-interviews",
    position: "sidebar",
    sequence: 2,
    actions: [
      actions.VIEW,
      actions.EDIT,
      actions.CREATE,
      actions.DELETE,
      actions.EXPORT,
    ],
    children: {},
  },
  IET_INTERVIEWS: {
    label: "IET - Interviews",
    icon: "iet",
    path: "/iet-interviews",
    position: "sidebar",
    sequence: 3,
    actions: [
      actions.VIEW,
      actions.EDIT,
      actions.CREATE,
      actions.DELETE,
      actions.EXPORT,
    ],
    children: {},
  },
  WITHDRAWALS_REFUND: {
    label: "Withdrawals & Refund",
    icon: "withdrawals",
    path: "/withdrawals-refund",
    position: "sidebar",
    sequence: 4,
    actions: [
      actions.VIEW,
      actions.EDIT,
      actions.CREATE,
      actions.DELETE,
      actions.EXPORT,
    ],
    children: {},
  },
  IET_NON_STANDARD_INTERVIEWS: {
    label: "IET & Non Standard - Interviews",
    icon: "iet_non_standard",
    path: "/iet-non-standard-interviews",
    position: "sidebar",
    sequence: 5,
    actions: [
      actions.VIEW,
      actions.EDIT,
      actions.CREATE,
      actions.DELETE,
      actions.EXPORT,
    ],
    children: {},
  },
  NON_STANDARD_INTERVIEWS: {
    label: "Non Standard - Interviews",
    icon: "non_standard",
    path: "/non-standard-interviews",
    position: "sidebar",
    sequence: 6,
    actions: [
      actions.VIEW,
      actions.EDIT,
      actions.CREATE,
      actions.DELETE,
      actions.EXPORT,
    ],
    children: {},
  },
});

const flattenPages = (obj, result = []) => {
  for (const key of Object.keys(obj)) {
    const entry = obj[key];
    result.push({
      key,
      label: entry.label,
      icon: entry.icon,
      path: entry.path,
      position: entry.position,
      sequence: entry.sequence,
      actions: entry.actions,
    });
    if (entry.children && Object.keys(entry.children).length > 0) {
      flattenPages(entry.children, result);
    }
  }
  return result;
};

const flatPages = flattenPages(pages);

const menuPositionsObj = deepFreeze({
  SIDEBAR: "sidebar",
  TOPBAR: "topbar",
  FOOTER: "footer",
});
const menuPositions = Object.values(menuPositionsObj);

export { pages, flatPages, menuPositions };
