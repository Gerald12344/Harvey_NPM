module.exports = {
    Command: function (input) {
        return `_INTERNAL_UUID_USED_FOR_STYLES + "_" + "${input[0]}"`;
    },
    Dependencies: function () {
        return false;
    },
};
