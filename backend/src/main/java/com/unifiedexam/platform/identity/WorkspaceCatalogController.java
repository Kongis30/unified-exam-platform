package com.unifiedexam.platform.identity;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 管理员账号页面读取工作区目录，用于动态显示授权选项。 */
@RestController
@RequestMapping("/api/admin/users/workspaces")
public class WorkspaceCatalogController {
    private final WorkspaceAccessService accessService;

    public WorkspaceCatalogController(WorkspaceAccessService accessService) {
        this.accessService = accessService;
    }

    @GetMapping
    public List<WorkspaceAccessService.Workspace> list() {
        return accessService.listWorkspaces();
    }
}
