import {
  ArrowRight,
  ArrowUpRight,
  Check,
  PackageCheck,
  CalendarDays,
  MapPin,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useSite } from "../SiteContext";
import { RentalFinder } from "../components/RentalFinder";
import { ProductCard } from "../components/ProductCard";
import { PageState } from "../components/PageState";
import { Img } from "../components/Img";
import { siteRepository } from "../data/siteRepository";

export function HomePage() {
  const { tenant, href, localizeProduct, language, isRemote, productsReady } =
    useSite();
  const en = language === "en";
  const catalog = siteRepository.getProducts(tenant);
  const singleCategory =
    tenant.categories.length === 1 ? tenant.categories[0] : null;
  const categoryLinks = singleCategory?.children.length
    ? singleCategory.children.map((child) => ({
        ...child,
        to: `/category/${encodeURIComponent(singleCategory.id)}?sub=${encodeURIComponent(child.id)}`,
      }))
    : tenant.categories.map((category) => ({
        ...category,
        to: `/category/${encodeURIComponent(category.id)}`,
      }));
  const categoryPicks = tenant.categories.map((category) =>
    catalog.find((product) => product.categoryId === category.id),
  );
  const featured = [
    ...new Map(
      [...categoryPicks, ...catalog]
        .filter((product) => product !== undefined)
        .map((product) => [product.id, product]),
    ).values(),
  ]
    .slice(0, 4)
    .map(localizeProduct);
  const steps = [
    {
      icon: <CalendarDays />,
      title: en ? "Choose your equipment and dates" : "选好商品与租期",
      description: en
        ? "Find the equipment and dates that fit your plan."
        : "找到适合的商品，选择这次需要使用的时间。",
    },
    {
      icon: <PackageCheck />,
      title: en ? "Review your rental" : "核对预约与费用",
      description: en
        ? "Review the quote and collection details before booking."
        : "查看报价，确认取还安排，再提交预约。",
    },
    {
      icon: <MapPin />,
      title: en ? "Collect, use and return" : "取走、使用、归还",
      description: en
        ? "Follow your confirmed booking for collection and return."
        : "按预约约定取货，使用结束后归还。",
    },
  ];

  return (
    <>
      <section className="shell home-opening">
        <div className="home-intro">
          <h1>{tenant.heroTitle}</h1>
          <div>
            <p>{tenant.heroDescription}</p>
            <Link className="text-link" to={href("/guide")}>
              {en ? "How your first rental works" : "第一次租？先看看流程"}
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="hero-scene">
          <Img
            src={tenant.heroImage}
            alt={
              isRemote
                ? tenant.name
                : en
                  ? "A van and camping equipment by the coast"
                  : "海边的小客车与露营装备"
            }
            loading="eager"
            fetchPriority="high"
            width="1600"
            height="800"
          />
          {!isRemote && (
            <div className="hero-caption">
              <span>
                {en ? "A weekend by the coast" : "留一段时间，去海边。"}
              </span>
              <span>{en ? "Equipment for your plans" : "按需租赁"}</span>
            </div>
          )}
        </div>
        <RentalFinder />
      </section>

      <section
        className="shell home-categories"
        aria-labelledby="categories-title"
      >
        <div className="section-heading">
          <h2 id="categories-title">
            {en ? "Find what you need" : "你的计划，需要什么？"}
          </h2>
          <Link className="text-link" to={href("/products")}>
            {en ? "All rentals" : "浏览全部商品"}
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
        <div className="category-tiles">
          {categoryLinks.map((category) => (
            <Link key={category.id} to={href(category.to)}>
              <Img src={category.image} alt="" width="800" height="800" />
              <div>
                <h3>{category.name}</h3>
                <span>{category.description}</span>
              </div>
              <ArrowUpRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className="shell home-featured">
        <div className="section-heading">
          <div>
            <h2>{en ? "Start with these" : "从这几件开始"}</h2>
            <p>
              {en
                ? "Explore the selection. Your dates determine availability."
                : "先看看商品，具体档期在选择租期后确认。"}
            </p>
          </div>
          <Link className="text-link" to={href("/products")}>
            {en ? "View all" : "查看全部"}
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
        {!productsReady ? (
          <div
            className="product-grid featured-grid"
            role="status"
            aria-label={en ? "Loading equipment" : "正在加载商品"}
            aria-busy="true"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <div className="product-card-skeleton" key={index} />
            ))}
          </div>
        ) : featured.length > 0 ? (
          <div className="product-grid featured-grid">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <PageState
            title={en ? "Equipment is being prepared" : "商品目录正在准备"}
            description={
              en
                ? "See our stores for rental help."
                : "可查看门店信息了解租赁安排。"
            }
          />
        )}
      </section>

      <section className="rental-story">
        <div className="shell story-inner">
          <div className="story-heading">
            <h2>
              {en
                ? "Choose your gear.\nGet ready to go."
                : "从选好装备，\n到准备出发。"}
            </h2>
            <Link className="button button-outline" to={href("/guide")}>
              {en ? "Read the rental guide" : "查看租赁指南"}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <ol className="rental-steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  {step.icon}
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="shell home-store-callout">
        <div>
          <h2>{en ? "Find a convenient store." : "找到方便取还的门店。"}</h2>
          <p>
            {isRemote
              ? tenant.address
              : en
                ? "Check the address and opening hours before planning collection."
                : "查看门店地址与营业时间，为这次取还提前安排。"}
          </p>
          <Link className="text-link" to={href("/about#stores")}>
            {en ? "Find a store" : "查找门店"}
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
        <div className="store-callout-note">
          <Check aria-hidden="true" />
          <p>
            {en
              ? "Review the store, dates and quote together in your booking."
              : "门店、租期与费用，\n都在预约中逐项核对。"}
          </p>
        </div>
      </section>
    </>
  );
}
