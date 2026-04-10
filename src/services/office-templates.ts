import type { BusinessCategory } from "../domain/engine.js";
import type { DepartmentKind, OfficeTemplateProfile, OfficeWorkerType } from "../domain/org.js";

export interface OfficeTemplateProfileSpec {
  id: OfficeTemplateProfile;
  label: string;
  businessCategories: BusinessCategory[];
  requiredDepartmentKinds: DepartmentKind[];
  approvalSections: string[];
  handoffSections: string[];
  departmentWidgetSections: string[];
  workerLabels: Record<OfficeWorkerType, string>;
}

const PROFILE_SPECS: OfficeTemplateProfileSpec[] = [
  {
    id: "catalog_store",
    label: "Catalog Store",
    businessCategories: ["digital_asset_store", "print_on_demand_store"],
    requiredDepartmentKinds: [
      "executive_management",
      "operations",
      "growth_marketing",
      "product_content",
      "finance",
      "analytics_research",
      "customer_support_qa"
    ],
    approvalSections: ["brand governance", "launch blockers", "public publishing"],
    handoffSections: ["brand to department routing", "catalog production flow", "storefront release flow"],
    departmentWidgetSections: ["execution_lanes", "artifacts", "kpis", "activity"],
    workerLabels: {
      engine_orchestrator: "Imon Engine Orchestrator",
      brand_orchestrator: "Brand Orchestrator",
      department_orchestrator: "Department Orchestrator",
      task_agent: "Task Agent",
      sub_agent: "Sub-agent"
    }
  },
  {
    id: "audience_brand",
    label: "Audience Brand",
    businessCategories: ["niche_content_site", "faceless_social_brand"],
    requiredDepartmentKinds: [
      "executive_management",
      "operations",
      "growth_marketing",
      "product_content",
      "analytics_research",
      "customer_support_qa"
    ],
    approvalSections: ["brand governance", "audience risk", "public channel reviews"],
    handoffSections: ["editorial routing", "campaign routing", "audience ops handoffs"],
    departmentWidgetSections: ["execution_lanes", "content_outputs", "pipeline_health", "kpis", "activity"],
    workerLabels: {
      engine_orchestrator: "Imon Engine Orchestrator",
      brand_orchestrator: "Brand Orchestrator",
      department_orchestrator: "Department Orchestrator",
      task_agent: "Task Agent",
      sub_agent: "Sub-agent"
    }
  },
  {
    id: "product_business",
    label: "Product Business",
    businessCategories: ["micro_saas_factory"],
    requiredDepartmentKinds: [
      "executive_management",
      "operations",
      "growth_marketing",
      "finance",
      "analytics_research",
      "customer_support_qa",
      "product_ops"
    ],
    approvalSections: ["release approval", "billing risk", "product governance"],
    handoffSections: ["release routing", "ops routing", "support escalation"],
    departmentWidgetSections: ["execution_lanes", "deliverables", "kpis", "activity"],
    workerLabels: {
      engine_orchestrator: "Imon Engine Orchestrator",
      brand_orchestrator: "Brand Orchestrator",
      department_orchestrator: "Department Orchestrator",
      task_agent: "Task Agent",
      sub_agent: "Sub-agent"
    }
  },
  {
    id: "service_business",
    label: "Service Business",
    businessCategories: ["client_services_agency"],
    requiredDepartmentKinds: [
      "executive_management",
      "operations",
      "growth_marketing",
      "finance",
      "analytics_research",
      "customer_support_qa",
      "product_content"
    ],
    approvalSections: ["client approvals", "delivery risk", "brand governance"],
    handoffSections: ["delivery routing", "client handoff", "support escalation"],
    departmentWidgetSections: ["execution_lanes", "deliverables", "kpis", "activity"],
    workerLabels: {
      engine_orchestrator: "Imon Engine Orchestrator",
      brand_orchestrator: "Brand Orchestrator",
      department_orchestrator: "Department Orchestrator",
      task_agent: "Task Agent",
      sub_agent: "Sub-agent"
    }
  }
];

const PROFILE_BY_CATEGORY = new Map<BusinessCategory, OfficeTemplateProfile>(
  PROFILE_SPECS.flatMap((profile) =>
    profile.businessCategories.map((category) => [category, profile.id] as const)
  )
);

export function officeTemplateProfileForCategory(
  category: BusinessCategory
): OfficeTemplateProfile {
  return PROFILE_BY_CATEGORY.get(category) ?? "service_business";
}

export function getOfficeTemplateProfileSpec(
  profile: OfficeTemplateProfile
): OfficeTemplateProfileSpec {
  return (
    PROFILE_SPECS.find((candidate) => candidate.id === profile) ?? PROFILE_SPECS[0]
  )!;
}
