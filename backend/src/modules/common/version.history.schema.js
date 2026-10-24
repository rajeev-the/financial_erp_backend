import { Schema } from "mongoose";
import commonFields from "./commonFields.object.js";
import timeStampObj from "./timestamps.object.js";
const versionHistorySchema = new Schema({
    version: {
        type: Number,
        required: true
    },
    metadata: {
        type: Schema.Types.Mixed,
        required: true
    },
    ...commonFields,
}, { timestamps: timeStampObj }
)
export default versionHistorySchema;