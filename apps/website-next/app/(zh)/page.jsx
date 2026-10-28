import { LanguageBootstrap } from "../../components/LanguageBootstrap";
import { sitePath } from "../../lib/site";
export default function Home() {
  return (
    <>
      <LanguageBootstrap home />
      <a href={sitePath("/harness/")}>Rental OS</a>
    </>
  );
}
