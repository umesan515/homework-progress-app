import { redirect } from "next/navigation";

export default function NullTemplateIdPage() {
  redirect("/teacher/templates");
}