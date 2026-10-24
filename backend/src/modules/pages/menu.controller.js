import mongoose from "mongoose";
import Menu from "./menu.schema.js";
import { menuPositions } from "./pages.object.js";
import { ApiError } from "../../utils/api-error.js";
import { ok } from "../../utils/response.js";

export const getMenus = async (req, res, next) => {
  try {
    const exclusionFields =
      "-is_deleted -is_active -createdAt -updatedAt -created_at -updated_at -__v -isParent";

    const menus = await Menu.find({ isParent: true })
      .select(exclusionFields)
      .populate({
        path: "child_menu",
        select: exclusionFields,
      })
      .sort({ sequence: 1 })
      .lean();

    return ok(res, menus, "Menus retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const createMenu = async (req, res, next) => {
  try {
    const { label, icon, path, position, parentId, sequence } = req.body;

    if (!label) {
      throw ApiError.badRequest("Label is required");
    }
    if (!menuPositions.includes(position)) {
      throw ApiError.badRequest("Invalid position");
    }
    if (parentId) {
      if (!mongoose.Types.ObjectId.isValid(parentId)) {
        throw ApiError.badRequest("Invalid parentId");
      }
      const parentMenu = await Menu.findById(parentId);
      if (!parentMenu) {
        throw ApiError.notFound("Parent menu not found");
      }
      const menu = new Menu({
        label,
        icon,
        path,
        position,
        isParent: false,
        child_menu: [],
        sequence: sequence || 0,
      });

      await menu.save();

      parentMenu.child_menu.push(menu._id);
      await parentMenu.save();

      return ok(res, menu, "Menu created successfully", 201);
    }

    const menu = new Menu({
      label,
      icon,
      path,
      position,
      isParent: true,
      child_menu: [],
      sequence: sequence || 0,
    });
    await menu.save();
    return ok(res, menu, "Menu created successfully", 201);
  } catch (error) {
    next(error);
  }
};

export const updateMenu = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { label, icon, path, position, sequence, parentId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw ApiError.badRequest("Invalid menu id");
    }

    const menu = await Menu.findById(id);
    if (!menu) {
      throw ApiError.notFound("Menu not found");
    }

    if (position !== undefined && !menuPositions.includes(position)) {
      throw ApiError.badRequest("Invalid position");
    }

    if (label !== undefined) menu.label = label;
    if (icon !== undefined) menu.icon = icon;
    if (path !== undefined) menu.path = path;
    if (position !== undefined) menu.position = position;
    if (sequence !== undefined) menu.sequence = sequence;

    if (parentId !== undefined) {
      const oldParentId = menu.parentId ? menu.parentId.toString() : null;

      if (parentId === null || parentId === "") {
        if (oldParentId) {
          await Menu.findByIdAndUpdate(oldParentId, {
            $pull: { child_menu: menu._id },
          });
        }
        menu.parentId = null;
        menu.isParent = true;
      } else {
        if (!mongoose.Types.ObjectId.isValid(parentId)) {
          throw ApiError.badRequest("Invalid parent id");
        }

        if (parentId === id) {
          throw ApiError.badRequest("A menu cannot be its own parent");
        }

        const parentMenu = await Menu.findById(parentId);
        if (!parentMenu) {
          throw ApiError.notFound("Parent menu not found");
        }
        if (oldParentId && oldParentId !== parentId) {
          await Menu.findByIdAndUpdate(oldParentId, {
            $pull: { child_menu: menu._id },
          });
        }
        menu.parentId = parentMenu._id;
        menu.isParent = false;
        if (!parentMenu.child_menu.includes(menu._id)) {
          parentMenu.child_menu.push(menu._id);
          await parentMenu.save();
        }
      }
    }

    await menu.save();
    const populated = await menu.populate("child_menu");
    return ok(res, populated, "Menu updated successfully");
  } catch (error) {
    next(error);
  }
};
