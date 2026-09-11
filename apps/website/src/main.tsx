import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type IconName =
  | "arrow"
  | "camera"
  | "car"
  | "tent"
  | "equipment"
  | "box"
  | "orders"
  | "money"
  | "users"
  | "check"
  | "play"
  | "menu"
  | "close";
const paths: Record<IconName, ReactNode> = {
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  camera: (
    <>
      <path d="m8 6 2-3h4l2 3h4v14H4V6Z" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  car: (
    <>
      <path d="m5 10 2-6h10l2 6M3 10h18v8H3ZM6 18v3m12-3v3M6 14h2m8 0h2" />
    </>
  ),
  tent: (
    <>
      <path d="m12 3 10 18H2L12 3Zm0 8-5 10m5-10 5 10M10 2l4 5" />
    </>
  ),
  equipment: (
    <>
      <path d="M3 17h11v4H3Zm2 0V9h7v8m0-8 4-5 5 9m-3 0h4v4h-6M7 9V5h5v4" />
    </>
  ),
  box: (
    <>
      <path d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5m-9 5v10M7 4.8l9 5" />
    </>
  ),
  orders: (
    <>
      <path d="M6 3h12v18H6ZM9 7h6M9 11h6m-6 4h3" />
    </>
  ),
  money: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m9 8 3 4 3-4m-6 4h6m-6 3h6m-3-3v5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  play: <path d="m9 5 10 7-10 7Z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Logo({ light = false }: { light?: boolean }) {
  return (
    <a
      className={`logo ${light ? "light" : ""}`}
      href="#home"
      aria-label="Rental OS 首页"
    >
      <img src="/favicon.svg" alt="" width="34" height="34" />
      <span>
        Rental <b>OS</b>
      </span>
    </a>
  );
}

const industries: {
  name: string;
  english: string;
  icon: IconName;
  image: string;
  title: string;
  description: string;
  points: string[];
  status: string;
}[] = [
  {
    name: "摄影器材",
    english: "CAMERA RENTAL SOFTWARE",
    icon: "camera",
    image: "hero-camera",
    title: "器材多、订单杂，\n用系统统一管理。",
    description:
      "面向摄影器材租赁企业，将商品档案、器材库存、预分配与交还检查放进同一套管理系统。",
    points: [
      "型号、资产与定价分组各司其职",
      "按租期查看可用量与分配情况",
      "交还后检查，符合条件再出租",
    ],
    status: "首批业务演练场景",
  },
  {
    name: "车辆载具",
    english: "VEHICLE RENTAL SOFTWARE",
    icon: "car",
    image: "vehicle",
    title: "从车组定价到车辆调度，\n业务信息统一管理。",
    description:
      "面向车辆租赁企业，分别维护厂牌车型、车辆资产和定价车组，衔接订单与车辆的使用安排。",
    points: [
      "独立管理车型与单台车辆",
      "定价车组包含多个车型",
      "衔接预约、分配、续租与归还",
    ],
    status: "行业适配场景 · 开放范围以演示为准",
  },
  {
    name: "露营装备",
    english: "OUTDOOR RENTAL SOFTWARE",
    icon: "tent",
    image: "camping",
    title: "装备按件或按数量，\n库存都能有据可查。",
    description:
      "面向露营装备租赁商户，兼顾独立资产与数量库存，为套装出租、分批交还和清点提供管理依据。",
    points: [
      "序列化资产与数量库存",
      "套装与增值服务组合出租",
      "归还后检查、清洁与缺件处理",
    ],
    status: "行业适配场景 · 开放范围以演示为准",
  },
  {
    name: "工程设备",
    english: "EQUIPMENT RENTAL SOFTWARE",
    icon: "equipment",
    image: "construction",
    title: "设备台账与租赁订单，\n不再分开记录。",
    description:
      "面向工程设备租赁企业，将型号、资产与订单关联起来，让设备占用和交还状态有据可查。",
    points: [
      "设备型号与单台资产台账",
      "按租期统筹可用库存",
      "异常设备隔离，检查后再投入",
    ],
    status: "行业适配场景 · 开放范围以演示为准",
  },
];
const flow = [
  {
    name: "预约报价",
    verb: "报价清楚，预约才踏实。",
    copy: "选择会员、租用商品和租期，查看租金、服务与优惠的组成。",
    state: "待确认",
    action: "查看商品分配",
    amount: "¥ 960.00",
    fact: "基础租金 ¥ 1,080.00 − 方案优惠 ¥ 120.00",
    detail: [
      "个人会员 · 陈先生（示例）",
      "09.18 10:00 — 09.21 10:00",
      "价格版本 v1.2 · 租期 3 天",
    ],
  },
  {
    name: "商品分配",
    verb: "先看可用，再安排交付。",
    copy: "检查租期与缓冲时间，为订单预分配具体资产，并锁定交付对象。",
    state: "已锁分配",
    action: "查看领取记录",
    amount: "2 件",
    fact: "2 件已分配 · 0 件待分配",
    detail: [
      "相机机身 · CAM-001",
      "标准变焦镜头 · LENS-008",
      "租期与缓冲时间 · 无占用冲突",
    ],
  },
  {
    name: "领取使用",
    verb: "交出去的每一件，都有记录。",
    copy: "核对资产与附件，记录领取检查结果，进入租用流程。",
    state: "租用中",
    action: "查看归还检查",
    amount: "2 / 2",
    fact: "已核对资产 · 领取附件齐全",
    detail: [
      "机身、镜头与电池 · 已核对",
      "领取检查 · 已记录",
      "续租前重新检查后续库存",
    ],
  },
  {
    name: "归还检查",
    verb: "归还了，不等于可出租了。",
    copy: "逐项记录交还与检查结果，异常商品保留待处理状态。",
    state: "检查完成",
    action: "查看结算结果",
    amount: "2 / 2",
    fact: "已交还 · 已检查 · 无异常费用",
    detail: [
      "相机机身 · 外观与功能正常",
      "镜头与附件 · 清点齐全",
      "缓冲时间结束后恢复可租",
    ],
  },
  {
    name: "费用结算",
    verb: "一笔订单，收尾也清清楚楚。",
    copy: "核对应收、已收与退款事项，保留费用来源及处理记录。",
    state: "已完成",
    action: "重新体验流程",
    amount: "¥ 0.00",
    fact: "应收 ¥ 960.00 · 示例已收 ¥ 960.00",
    detail: ["待补款 · ¥ 0.00", "待退款 · 无", "订单完成 · 资产按规则恢复可租"],
  },
];
const faqs = [
  [
    "Rental OS 是租赁商城，还是商户管理系统？",
    "Rental OS 面向租赁商户，管理会员、商品、库存、价格与订单。这里是产品官网，不是租客下单商城。租客端 App 和线上预订入口属于后续独立交付范围。",
  ],
  [
    "一个商户可以管理不同的租赁品类吗？",
    "产品按经营空间组织业务。同一商户可设置不同品类的空间，共享客户主档，并分别管理各空间的商品、价格、库存与订单。",
  ],
  [
    "可以按小时、按天收费，也能处理续租吗？",
    "计价单位、价格与续租方式由经营规则决定。演示时可以结合你的计费习惯，核对按小时、按天、续租、逾时和优惠的具体计算结果。",
  ],
  [
    "现在可以直接开通并用于正式经营吗？",
    "当前以首批业务演练和产品演示为主。正式使用前，需要确认行业功能、环境、权限和收退款方案。本页面不提供自动开通，也不处理真实客户款项。",
  ],
];

function App() {
  const [industry, setIndustry] = useState(0);
  const [step, setStep] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"demo" | "privacy" | "login" | null>(
    null,
  );
  const [submitted, setSubmitted] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const current = industries[industry];
  const stage = flow[step];
  const adminUrl = import.meta.env.VITE_ADMIN_URL as string | undefined;
  const safeAdminUrl =
    adminUrl && /^https?:\/\//.test(adminUrl) ? adminUrl : undefined;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dialog) return;
    opener.current = document.activeElement as HTMLElement;
    modal.current?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      modal.current?.close();
      document.body.style.overflow = oldOverflow;
      opener.current?.focus();
    };
  }, [dialog]);

  const openDemo = () => {
    setSubmitted(false);
    setMenuOpen(false);
    setDialog("demo");
  };
  const closeDialog = () => setDialog(null);
  const submitPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Preview only: never transmit or persist the visitor's contact information.
    setSubmitted(true);
  };
  const goIndustry = (index: number) => {
    setIndustry(index);
    document
      .getElementById("industries")
      ?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  };

  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <header className="header">
        <div className="nav-inner">
          <Logo />
          <nav
            aria-label="主导航"
            className={menuOpen ? "nav-links open" : "nav-links"}
          >
            <a href="#product" onClick={() => setMenuOpen(false)}>
              产品功能
            </a>
            <a href="#industries" onClick={() => setMenuOpen(false)}>
              适用行业
            </a>
            <a href="#plans" onClick={() => setMenuOpen(false)}>
              订阅咨询
            </a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>
              常见问题
            </a>
          </nav>
          <div className="nav-actions">
            {safeAdminUrl ? (
              <a
                className="login-link"
                href={safeAdminUrl}
                target="_blank"
                rel="noreferrer"
              >
                管理端登录 <span>↗</span>
              </a>
            ) : (
              <button className="login-link" onClick={() => setDialog("login")}>
                管理端登录 <span>↗</span>
              </button>
            )}
            <button className="button primary nav-demo" onClick={openDemo}>
              预约演示 <Icon name="arrow" />
            </button>
            <button
              className="menu-toggle"
              aria-label={menuOpen ? "关闭导航" : "打开导航"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        <section id="home" className="hero">
          <img
            className="hero-image"
            src="/images/hero-camera.png"
            alt="明亮的器材租赁工作室内，相机、镜头与收纳箱整齐放置"
            fetchPriority="high"
            width="1672"
            height="941"
          />
          <div className="hero-shade" />
          <div className="hero-inner">
            <div className="eyebrow hero-enter">
              <span className="blue-dash" /> 面向租赁企业的 SaaS 管理系统
            </div>
            <h1 className="hero-enter">
              Rental <span>OS</span>
            </h1>
            <h2 className="hero-enter">
              租赁业务管理，
              <br />
              一套系统协同。
            </h2>
            <p className="hero-enter">
              为租赁公司连接订单、库存、计费与客户。
              <br />
              从日常运营到团队协作，用系统管理每个环节。
            </p>
            <div className="hero-buttons hero-enter">
              <button className="button primary" onClick={openDemo}>
                预约系统演示 <Icon name="arrow" />
              </button>
              <a className="button glass" href="#product">
                <Icon name="play" /> 了解系统功能
              </a>
            </div>
            <div className="hero-note hero-enter">
              <span className="status-dot" /> 首批摄影租赁业务演练中
            </div>
          </div>
          <div className="hero-caption">
            RENTAL BUSINESS SOFTWARE <span>软件服务 · 面向租赁企业</span>
          </div>
        </section>

        <div className="industry-strip">
          <div className="strip-inner">
            <p>
              不同的租赁业务
              <br />
              <strong>同样清晰的管理</strong>
            </p>
            {industries.map((item, i) => (
              <button key={item.name} onClick={() => goIndustry(i)}>
                <Icon name={item.icon} />
                <span>{item.name}</span>
                <span className="strip-arrow">↗</span>
              </button>
            ))}
          </div>
        </div>

        <section id="product" className="section product-section">
          <div className="section-heading reveal">
            <div>
              <div className="eyebrow">01 — CONNECT YOUR WORKFLOW</div>
              <h2>
                不止接到订单。
                <br />
                <span className="muted">更要把每一单做好。</span>
              </h2>
            </div>
            <p>
              订单、商品和费用不再各管一段。
              <br />
              让每个环节，都接得上下一步。
            </p>
          </div>
          <div
            className="workflow-tabs reveal"
            role="tablist"
            aria-label="租赁流程演示"
          >
            {flow.map((item, i) => (
              <button
                key={item.name}
                id={`flow-tab-${i}`}
                role="tab"
                aria-selected={step === i}
                aria-controls="flow-panel"
                tabIndex={step === i ? 0 : -1}
                onKeyDown={(e) => {
                  if (
                    ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    const next =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 4
                          : (step + (e.key === "ArrowRight" ? 1 : 4)) % 5;
                    setStep(next);
                    document.getElementById(`flow-tab-${next}`)?.focus();
                  }
                }}
                onClick={() => setStep(i)}
              >
                <span>0{i + 1}</span>
                {item.name}
                <Icon name="arrow" />
              </button>
            ))}
          </div>
          <div
            className="product-display reveal"
            id="flow-panel"
            role="tabpanel"
            aria-labelledby={`flow-tab-${step}`}
          >
            <div className="product-story" key={`story-${step}`}>
              <span className="chapter">0{step + 1} / 05</span>
              <h3>{stage.verb}</h3>
              <p>{stage.copy}</p>
              <button
                className="text-link"
                onClick={() => setStep((step + 1) % 5)}
              >
                {stage.action}
                <Icon name="arrow" />
              </button>
              <small>交互示意 · 非实时业务数据</small>
            </div>
            <div className="app-window">
              <div className="window-top">
                <span className="window-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>Rental OS / 摄影器材经营空间</span>
                <span className="demo-tag">产品流程示意</span>
              </div>
              <div className="app-body">
                <aside className="app-sidebar">
                  <span className="mini-logo">
                    R<span>OS</span>
                  </span>
                  <div>
                    <Icon name="box" /> 运营概览
                  </div>
                  <div className="selected">
                    <Icon name="orders" /> 租赁订单
                  </div>
                  <div>
                    <Icon name="camera" /> 器材资产
                  </div>
                  <div>
                    <Icon name="money" /> 定价管理
                  </div>
                  <div>
                    <Icon name="users" /> 会员管理
                  </div>
                  <span className="workspace-caption">摄影器材空间⌄</span>
                </aside>
                <div className="app-content" key={`app-${step}`}>
                  <div className="app-breadcrumb">租赁订单 / 订单详情</div>
                  <div className="app-order-heading">
                    <div>
                      <h4>拍摄器材租赁</h4>
                      <span>DEMO-20260918001</span>
                    </div>
                    <span className="order-status">{stage.state}</span>
                  </div>
                  <div className="order-item">
                    <img
                      src="/images/hero-camera.png"
                      alt="示例相机套装"
                      loading="lazy"
                    />
                    <div>
                      <strong>全画幅相机 + 标准变焦镜头</strong>
                      <span>标准拍摄组合 · 2 件器材</span>
                    </div>
                  </div>
                  <div className="order-facts">
                    {stage.detail.map((line, i) => (
                      <div key={line}>
                        <span className="fact-check">
                          <Icon name="check" />
                        </span>
                        {line}
                        <span className="fact-index">0{i + 1}</span>
                      </div>
                    ))}
                  </div>
                  <div className="order-total">
                    <div>
                      <span>
                        {step === 0
                          ? "报价应付"
                          : step === 4
                            ? "剩余待结算"
                            : "本环节核对"}
                      </span>
                      <strong>{stage.amount}</strong>
                    </div>
                    <span>{stage.fact}</span>
                  </div>
                  <div className="app-footnote">
                    <Icon name="check" /> 每一步状态与操作，都留有记录。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="benefits section reveal" aria-label="产品能力">
          <div className="benefit">
            <Icon name="box" />
            <h3>资产安排，看得清。</h3>
            <p>
              区分型号、定价分组与具体资产，
              <br />
              让可用、占用与待检查各有归属。
            </p>
            <span>商品与库存管理</span>
          </div>
          <div className="benefit">
            <Icon name="money" />
            <h3>每笔费用，说得明。</h3>
            <p>
              租金、服务与优惠分别列明，
              <br />
              调价有版本，续租有计算依据。
            </p>
            <span>定价与订单费用</span>
          </div>
          <div className="benefit">
            <Icon name="users" />
            <h3>团队协作，分得开。</h3>
            <p>
              客户主档共享，经营空间独立，
              <br />
              不同员工按角色与空间分配权限。
            </p>
            <span>会员与经营空间</span>
          </div>
        </section>

        <section id="industries" className="industry-section">
          <div className="section">
            <div className="section-heading reveal">
              <div>
                <div className="eyebrow">02 — BUILT FOR YOUR BUSINESS</div>
                <h2>
                  不同租赁行业，
                  <br />
                  适配各自的管理方式。
                </h2>
              </div>
              <p>
                统一的经营基础，适合各自品类的业务方式。
                <br />
                从你的行业出发，了解 Rental OS。
              </p>
            </div>
            <div className="industry-layout reveal">
              <div className="industry-menu" aria-label="选择行业">
                {industries.map((item, i) => (
                  <button
                    className={industry === i ? "active" : ""}
                    key={item.name}
                    onClick={() => setIndustry(i)}
                    aria-pressed={industry === i}
                  >
                    <span>
                      <Icon name={item.icon} />
                      {item.name}
                    </span>
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
              <div className="industry-photo" key={current.image}>
                <img
                  src={`/images/${current.image}.png`}
                  alt={`${current.name}租赁场景（AI 生成）`}
                  loading="lazy"
                  width="1536"
                  height="1024"
                />
                <span>{current.english}</span>
              </div>
              <div className="industry-copy" key={current.name}>
                <span className="eyebrow">{current.name}</span>
                <h3>{current.title}</h3>
                <p>{current.description}</p>
                <ul>
                  {current.points.map((point) => (
                    <li key={point}>
                      <Icon name="check" />
                      {point}
                    </li>
                  ))}
                </ul>
                <button className="text-link" onClick={openDemo}>
                  了解适用方案 <Icon name="arrow" />
                </button>
                <small>{current.status}</small>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="faq-section section reveal">
          <div>
            <div className="eyebrow">03 — GOOD TO KNOW</div>
            <h2>
              开始之前，
              <br />
              你可能想知道。
            </h2>
            <p>先把业务聊清楚，再看产品是否适合。</p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer], i) => (
              <details key={question} open={i === 0 ? true : undefined}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="plans" className="final-cta">
          <div className="cta-ring" aria-hidden="true" />
          <div className="section cta-inner reveal">
            <div>
              <div className="eyebrow">RENTAL OS / SAAS SUBSCRIPTION</div>
              <h2>
                为你的租赁企业，
                <br />
                选择一套合适的系统。
              </h2>
              <p>先演示业务流程，再沟通适用功能与 SaaS 订阅方案。</p>
            </div>
            <div className="cta-actions">
              <button className="button white" onClick={openDemo}>
                咨询系统订阅方案 <Icon name="arrow" />
              </button>
              <span>具体价格与服务范围在方案沟通时确认</span>
            </div>
          </div>
        </section>
      </main>
      <footer className="section footer">
        <div>
          <Logo />
          <p>租赁企业的 SaaS 经营管理系统。</p>
        </div>
        <div className="footer-links">
          <a href="#product">产品功能</a>
          <a href="#industries">适用行业</a>
          <button onClick={() => setDialog("privacy")}>隐私说明</button>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Rental OS</span>
          <span>
            官网预览版 · 场景图片由 AI 生成 · 功能开放范围以实际演示为准
          </span>
        </div>
      </footer>

      <dialog
        ref={modal}
        className="modal"
        onCancel={closeDialog}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              closeDialog();
          }
        }}
        aria-labelledby="dialog-title"
      >
        <button
          className="modal-close"
          onClick={closeDialog}
          aria-label="关闭弹窗"
        >
          <Icon name="close" />
        </button>
        {dialog === "demo" && (
          <>
            <span className="eyebrow">LET’S TALK RENTAL</span>
            <h2 id="dialog-title">从你的业务开始。</h2>
            <p className="modal-intro">
              告诉我们你在经营什么，找到适合的演示场景。
            </p>
            {submitted ? (
              <div className="preview-result" role="status">
                <Icon name="check" />
                <h3>预约表单预览完成</h3>
                <p>
                  这是本地官网预览，信息没有发送或保存。正式预约将在接入联系渠道后开放。
                </p>
                <button className="button primary" onClick={closeDialog}>
                  返回官网 <Icon name="arrow" />
                </button>
              </div>
            ) : (
              <form onSubmit={submitPreview}>
                <label>
                  商户名称
                  <input
                    name="company"
                    required
                    maxLength={80}
                    placeholder="例如：光影器材租赁"
                    autoComplete="organization"
                  />
                </label>
                <div className="form-row">
                  <label>
                    你的称呼
                    <input
                      name="name"
                      required
                      maxLength={40}
                      placeholder="怎么称呼你"
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    经营品类
                    <select name="industry" defaultValue={current.name}>
                      {industries.map((item) => (
                        <option key={item.name}>{item.name}</option>
                      ))}
                      <option>其他租赁业务</option>
                    </select>
                  </label>
                </div>
                <label>
                  手机号或 Email
                  <input
                    name="contact"
                    required
                    maxLength={120}
                    minLength={5}
                    placeholder="填写一种方便联系的方式"
                  />
                </label>
                <label>
                  想重点了解什么 <span className="optional">（选填）</span>
                  <textarea
                    name="needs"
                    maxLength={500}
                    rows={3}
                    placeholder="例如：多门店库存、长短租计费、企业会员…"
                  />
                </label>
                <p className="preview-notice">
                  预览模式：表单仅用于体验，不发送、不保存个人信息。
                </p>
                <button className="button primary form-submit" type="submit">
                  预览预约结果 <Icon name="arrow" />
                </button>
              </form>
            )}
          </>
        )}
        {dialog === "privacy" && (
          <>
            <span className="eyebrow">PRIVACY</span>
            <h2 id="dialog-title">预览版隐私说明</h2>
            <p>
              本版本不连接业务数据库，不发送预约信息，不使用广告追踪或分析
              Cookie。表单内容仅在当前页面内用于演示，刷新或关闭后不保留。
            </p>
            <p>
              页面所示订单与会员为虚构示例，行业照片由 AI
              生成，不代表真实客户案例。
            </p>
            <p>
              正式上线时，将根据实际运营主体和信息处理方式提供完整隐私政策。
            </p>
          </>
        )}
        {dialog === "login" && (
          <>
            <span className="eyebrow">RENTAL OS ADMIN</span>
            <h2 id="dialog-title">管理端独立运行</h2>
            <p>
              此官网预览尚未配置管理端地址。请使用现有的租户管理端入口登录；官网不会接收你的账号和密码。
            </p>
            <button className="button primary" onClick={closeDialog}>
              知道了 <Icon name="arrow" />
            </button>
          </>
        )}
      </dialog>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
