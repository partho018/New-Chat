import { z } from "zod";

export const HealthCheckResponse = z.object({
  status: z.string(),
});

export type AuthUser = {
  id: string;
  email: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};
