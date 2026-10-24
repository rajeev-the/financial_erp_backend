import mongoose from 'mongoose';
import envConfig from './env.js';
const connectDB = async () => {
    try{
      await mongoose.connect(envConfig.MONGO_URI);
      console.log('MongoDB connected successfully');
    }catch(err){
        console.error('MongoDB connection failed:', err.message);
        process.exit(1);
    }

};
export default connectDB;