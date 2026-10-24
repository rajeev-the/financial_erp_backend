import Menu from "./menu.schema.js";
import ActionMaster from "./actionMaster.schema.js";
import { pages } from "./pages.object.js";

const upsertAction = async (actionName) => {
  const existing = await ActionMaster.findOne({ name: actionName });
  if (existing) return existing;
  const action = new ActionMaster({ name: actionName });
  await action.save();
  return action;
};

const seedChildren = async (children, actionCache) => {
  const childIds = [];

  for (const key of Object.keys(children)) {
    const child = children[key];

    for (const actionName of child.actions) {
      if (!actionCache[actionName]) {
        actionCache[actionName] = await upsertAction(actionName);
      }
    }

    let nestedChildIds = [];
    const hasChildren =
      child.children && Object.keys(child.children).length > 0;
    if (hasChildren) {
      nestedChildIds = await seedChildren(child.children, actionCache);
    }

    const existingMenu = await Menu.findOne({
      label: child.label,
      path: child.path,
    });
    if (existingMenu) {
      existingMenu.icon = child.icon;
      existingMenu.sequence = child.sequence;
      existingMenu.position = child.position;
      existingMenu.isParent = hasChildren;
      existingMenu.child_menu = nestedChildIds;
      await existingMenu.save();
      childIds.push(existingMenu._id);
    } else {
      const menu = new Menu({
        label: child.label,
        icon: child.icon,
        path: child.path,
        position: child.position,
        isParent: hasChildren,
        sequence: child.sequence,
        child_menu: nestedChildIds,
      });
      await menu.save();
      childIds.push(menu._id);
    }
  }

  return childIds;
};

const seedMenus = async () => {
  const actionCache = {};
  const seededParents = [];

  for (const key of Object.keys(pages)) {
    const group = pages[key];

    for (const actionName of group.actions) {
      if (!actionCache[actionName]) {
        actionCache[actionName] = await upsertAction(actionName);
      }
    }

    const childIds = await seedChildren(group.children, actionCache);

    const existingMenu = await Menu.findOne({ label: group.label });
    if (existingMenu) {
      existingMenu.icon = group.icon;
      existingMenu.path = group.path;
      existingMenu.position = group.position;
      existingMenu.isParent = true;
      existingMenu.sequence = group.sequence;
      existingMenu.child_menu = childIds;
      await existingMenu.save();
      seededParents.push(existingMenu);
    } else {
      const menu = new Menu({
        label: group.label,
        icon: group.icon,
        path: group.path,
        position: group.position,
        isParent: true,
        sequence: group.sequence,
        child_menu: childIds,
      });
      await menu.save();
      seededParents.push(menu);
    }
  }

  const totalActions = Object.keys(actionCache).length;
  const totalMenus = await Menu.countDocuments();

  return {
    message: "Menu seeding completed",
    seeded_parents: seededParents.length,
    total_menus: totalMenus,
    total_actions: totalActions,
  };
};

export { seedMenus };
