import { sanitizeUserDisplayName } from "@phit-erp/shared";
import { User } from "../models/User.js";

/** One-time-safe migration: renames legacy "Demo …" display names without touching IDs or credentials. */
export const migrateLegacyDemoDisplayNames = async (): Promise<void> => {
  const users = await User.find({ fullName: /^Demo\s/i }).select("_id fullName");

  if (!users.length) {
    return;
  }

  await Promise.all(
    users.map(async (user) => {
      const nextName = sanitizeUserDisplayName(user.fullName);
      if (nextName === user.fullName) {
        return;
      }

      await User.updateOne({ _id: user._id }, { $set: { fullName: nextName } });
    })
  );

  console.log(`Updated ${users.length} legacy demo display name(s).`);
};