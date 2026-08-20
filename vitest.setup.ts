import "dotenv/config";
import "@testing-library/jest-dom/vitest";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
