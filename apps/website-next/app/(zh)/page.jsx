import { LanguageBootstrap } from "../../components/LanguageBootstrap";
import { SiteApp } from "../../components/SiteApp";
export default function Home() {
  return (
    <>
      <LanguageBootstrap home />
      <SiteApp locale="zh" />
    </>
  );
}
