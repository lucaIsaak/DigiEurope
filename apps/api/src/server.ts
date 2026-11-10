import { buildApp } from "./app.js";

const port = Number(process.env.API_PORT ?? 4000);

buildApp()
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
