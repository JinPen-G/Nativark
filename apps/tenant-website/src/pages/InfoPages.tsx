import { Link } from "react-router-dom";
import { Document } from "../components/SiteIcon";
import { Breadcrumbs, PageHeading } from "../components/PageHeader";
import { Img } from "../components/Img";
import { useSite } from "../SiteContext";
import { PageState } from "../components/PageState";
import { StoreDirectory } from "../components/StoreDirectory";
import photoSources from "../../public/media/photo-sources.json";

export function AboutPage() {
  const { tenant, href, t, language, isRemote } = useSite();
  const en = language === "en";
  return (
    <div className="shell simple-page about-page">
      <Breadcrumbs
        items={[{ label: t("home"), to: href("/") }, { label: t("about") }]}
      />
      <div className="about-opening">
        <div>
          <h1>{t("aboutTitle", { name: tenant.name })}</h1>
          <p>{tenant.footerText}</p>
          <Link className="text-link" to={href("/products")}>
            {en ? "Find your equipment" : "开始选择商品"}
          </Link>
        </div>
        <div className="about-image">
          <Img
            src={tenant.heroImage}
            alt=""
            width="1600"
            height="800"
            loading="eager"
          />
        </div>
      </div>
      <StoreDirectory />
      {!isRemote && (
        <details className="media-credits" id="photo-credits">
          <summary>{en ? "Demo photography credits" : "演示图片来源"}</summary>
          <p>
            {en
              ? "The coastal scene and camera image were created for this demo. Product photography below is licensed from Wikimedia Commons and resized for the catalog."
              : "海边场景与相机图片为本次演示新制作。以下商品摄影来自 Wikimedia Commons，按原许可使用并调整尺寸。"}
          </p>
          <ul>
            {photoSources.map((photo) => (
              <li key={photo.file}>
                <span>
                  {photo.file} — {photo.author}
                </span>
                <a href={photo.source} target="_blank" rel="noreferrer">
                  {en ? "Original photo" : "原始摄影"}
                </a>
                {photo.licenseUrl && (
                  <a href={photo.licenseUrl} target="_blank" rel="noreferrer">
                    {photo.license}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function GuidePage() {
  const { href, t, language } = useSite();
  const en = language === "en";
  const steps = [
    {
      title: t("guideChoose"),
      text: t("guideChooseText"),
      details: en
        ? [
            "Browse a category or search by product name.",
            "Compare specifications and included accessories.",
          ]
        : ["按品类浏览，或搜索具体型号。", "查看规格参数、配件和商品说明。"],
      to: "/products",
      action: en ? "Browse equipment" : "浏览商品",
    },
    {
      title: t("guideTerm"),
      text: t("guideTermText"),
      details: en
        ? [
            "Choose collection and return times, quantity and location.",
            "Availability and billable terms are confirmed in your quote.",
          ]
        : [
            "选择取还时间、数量与方便的门店。",
            "库存与计费租期由预约报价确认。",
          ],
      to: "/products",
      action: en ? "Plan your rental" : "选择租期",
    },
    {
      title: t("guideSubmit"),
      text: t("guideSubmitText"),
      details: en
        ? [
            "Check contact details and collection or delivery arrangements.",
            "Review rent, deposit and delivery fees before submitting.",
          ]
        : [
            "核对联系人与取还方式。",
            "提交前看清租金、押金及可能产生的配送费用。",
          ],
      to: "/help",
      action: en ? "Rental questions" : "查看常见问题",
    },
    {
      title: t("guideConfirm"),
      text: t("guideConfirmText"),
      details: en
        ? [
            "Keep the booking details and confirm collection arrangements.",
            "Check equipment and accessories at collection and return.",
          ]
        : [
            "保留预约信息，与门店确认实际取还安排。",
            "取用和归还时，一起核对设备状态与配件。",
          ],
      to: "/orders",
      action: en ? "View your rentals" : "查看我的租赁",
    },
  ];

  return (
    <div className="shell simple-page guide-page">
      <Breadcrumbs
        items={[
          { label: t("home"), to: href("/") },
          { label: t("guideTitle") },
        ]}
      />
      <PageHeading
        title={t("guideTitle")}
        description={t("guideDescription")}
      />
      <div className="guide-layout">
        <nav
          className="guide-index"
          aria-label={en ? "On this page" : "本页内容"}
        >
          {steps.map((step, index) => (
            <a href={"#guide-step-" + index} key={step.title}>
              {step.title}
            </a>
          ))}
        </nav>
        <div className="guide-list">
          {steps.map((step, index) => (
            <section key={step.title} id={"guide-step-" + index}>
              <h2>
                <span aria-hidden="true">{index + 1}</span>
                {step.title}
              </h2>
              <p>{step.text}</p>
              <ul>
                {step.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              <Link className="text-link" to={href(step.to)}>
                {step.action}
              </Link>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  const { href, language, t } = useSite();
  return (
    <div className="shell not-found-page">
      <PageState
        heading="h1"
        icon={<Document />}
        title={
          language === "en"
            ? "This page could not be found"
            : "没有找到这个页面"
        }
        description={
          language === "en"
            ? "The link may have changed. You can continue browsing the catalog."
            : "链接可能已变更，可以返回首页或继续浏览商品。"
        }
      >
        <Link className="button button-dark" to={href("/products")}>
          {t("browseProducts")}
        </Link>
        <Link className="button button-outline" to={href("/")}>
          {t("backHome")}
        </Link>
      </PageState>
    </div>
  );
}
