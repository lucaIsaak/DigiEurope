"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Inputs & setup was merged into Templates (test & confirm, reading) and Settings. Old links still work. */
export default function InputsMoved() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/office/templates");
  }, [router]);
  return null;
}
