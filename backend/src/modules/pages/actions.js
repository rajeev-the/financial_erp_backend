const actions = Object.freeze({
    "VIEW": "view",
    "EDIT": "edit",
    "DELETE": "delete",
    "CREATE": "create",
    "UPDATE": "update",
    "IMPORT": "import",
    "EXPORT": "export",
    "DOWNLOAD": "download",
    "UPLOAD": "upload",
    "VERSION": "version",
    "VERSION_ROLLBACK": "version_rollback"
});

const allowedActions = Object.values(actions);

export { actions, allowedActions };