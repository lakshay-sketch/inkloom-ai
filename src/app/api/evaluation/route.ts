import { route } from "@/server/http";
import { runEvaluation } from "@/core/evaluation";

export const POST = route(() => runEvaluation());
