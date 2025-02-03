import Webpack from "@modules/webpackmodules";
import Button, {Colors} from "@ui/base/button";
import React from "@modules/react";
import Logger from "@common/logger";
import DiscordModules from "@modules/discordmodules";
import Strings from "@modules/strings";
import Builtin from "@structs/builtin";
import Settings from "@modules/settingsmanager";
import pluginmanager from "@modules/pluginmanager";
import Toasts from "@ui/toasts";
import Modals from "@ui/modals";

const Dispatcher = DiscordModules.Dispatcher;

async function attemptRecovery() {
    const transitionTo = Webpack.getByString("transitionTo - Transitioning to", {searchExports: true});
    
    const recoverySteps = [
        {
            action: () => Dispatcher?.dispatch?.({type: "LAYER_POP_ALL"}),
            errorMessage: "Failed to pop all layers"
        },
        {
            action: () => Dispatcher?.dispatch?.({type: "MODAL_POP_ALL"}),
            errorMessage: "Failed to pop all modals"
        },
        {
            action: () => transitionTo?.("/channels/@me"),
            errorMessage: "Failed to route to main channel"
        }
    ];

    for (const {action, errorMessage} of recoverySteps) {
        try {
            await action();
        } 
        catch (error) {
            Logger.error("Recovery", `${errorMessage}:, ${error}`);
        }
    }
}

const parseGithubUrl = (url) => {
    try {
        const urlObj = new URL(url?.replace(/^(http:\/\/|git:\/\/|git\+https:\/\/|git@)/, "https://"));
        if (!urlObj.hostname.includes("github")) return null;
        const [owner, repo] = urlObj.pathname.split("/").filter(Boolean);
        return owner && repo ? `https://github.com/${owner}/${repo.replace(/\.git$/, "")}` : null;
    } 
    catch {
        return null;
    }
};

const ErrorDetails = ({componentStack, pluginInfo, stack, instance}) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [height, setHeight] = React.useState(0);
    const contentRef = React.useRef(null);

    React.useEffect(() => {
        const updateHeight = () => {
            if (isExpanded) {
                const maxHeight = Math.min(0.6 * window.innerHeight, 534);
                setHeight(maxHeight);
            }
            else {
                setHeight(0);
            }
        };

        updateHeight();
        window.addEventListener("resize", updateHeight);
        return () => window.removeEventListener("resize", updateHeight);
    }, [isExpanded]);

    const openGithubIssue = () => {
        if (pluginInfo?.githubUrl) {
            const baseRepoUrl = parseGithubUrl(pluginInfo.githubUrl);
            if (!baseRepoUrl) return;
            
            const issueTitle = encodeURIComponent(`[Bug Report] Plugin Crash - ${pluginInfo?.name} v${pluginInfo?.version}`);
            const issueBody = encodeURIComponent(
                `### Error Details\n\`\`\`js\n${stack}\n\`\`\`\n - Generated by BD Recovery Builtin.` + "\n\n### Steps to Reproduce\n1.\n2.\n3.\n\n" + "### Additional Context\n"
            );
            window.open(`${baseRepoUrl}/issues/new?title=${issueTitle}&body=${issueBody}`, "_blank");
        }
    };

    const openDiscordSupport = () => {
        if (pluginInfo?.invite) {
            attemptRecovery();
            instance.setState({info: null, error: null});
            if (pluginInfo.invite) Modals.showGuildJoinModal(pluginInfo.invite);
        }
    };

    return (
        <div className="bd-error-container">
            <div className="bd-error-toggle-wrapper">
                <Button
                    className={`bd-error-toggle ${isExpanded ? "expanded" : ""}`}
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    {isExpanded ? "Hide Error Details ▼" : "Show Error Details ▶"}
                </Button>
                <div className="bd-error-actions">
                    {pluginInfo?.githubUrl && (
                        <Button
                            className="bd-error-github"
                            onClick={openGithubIssue}
                            color={Colors.YELLOW}
                        >
                            {Strings.Collections.settings.developer.recovery.report}
                        </Button>
                    )}
                    {pluginInfo?.invite && (
                        <Button
                            className="bd-error-discord"
                            onClick={openDiscordSupport}
                        >
                            {Strings.Addons.invite}
                        </Button>
                    )}
                </div>
            </div>
            <div
                className="bd-error-content-wrapper"
                style={{height: `${height}px`, overflow: "hidden"}}
            >
                <div ref={contentRef} className="bd-error-content">
                    {componentStack}
                </div>
            </div>
        </div>
    );
};

export default new class Recovery extends Builtin {
    get name() {return "Recovery";}
    get category() {return "developer";}
    get id() {return "recovery";}

    async enabled() {
        this.patchErrorBoundry();
        this.parseModule = Webpack.getByProps("defaultRules", "parse");
    }

    async disabled() {
        this.unpatchAll();
    }

    getPluginInfo(pluginName) {
        try {
            const plugin = pluginmanager.getPlugin(pluginName);
            return {
                name: plugin.name || pluginName,
                githubUrl: plugin.source || plugin.github,
                invite: plugin.invite || null,
                version: plugin.version || `0.0.0`
            };
        }
        catch (error) {
            Logger.error("Recovery", `Failed to get plugin info: ${error}`);
            return null;
        }
    }

    patchErrorBoundry() {
        const mod = Webpack.getByPrototypes("_handleSubmitReport");

        this.after(mod?.prototype, "render", (instance, args, retValue) => {
            if (!Settings.get(this.collection, this.category, this.id)) return;
            const buttons = retValue?.props?.action?.props;

            if (!buttons) return;

            const errorStack = instance.state;
            const parsedError = errorStack ? this.parseModule.parse(`\`\`\`${errorStack.error?.stack}\n\n${errorStack.info?.componentStack}\`\`\``) : null;

            const foundIssue = /betterdiscord:\/\/(plugins)\/(.*?).(\w+).js/.exec(errorStack.error?.stack);
            let pluginInfo = null;
            
            if (foundIssue) {
                const pluginName = `${foundIssue[2]}.plugin.js`;
                pluginInfo = this.getPluginInfo(pluginName);
                pluginmanager.disableAddon(foundIssue[2]);
                Toasts.show(`Plugin ${pluginName} has been disabled to prevent crashes. Please report this issue to the developer.`);
            }

            buttons.children.push(
                <Button
                    className="bd-button-recovery"
                    onClick={() => {
                        attemptRecovery();
                        instance.setState({info: null, error: null});
                    }}
                >
                    {Strings.Collections.settings.developer.recovery.button}
                    </Button>,
                parsedError && <ErrorDetails componentStack={parsedError} stack={errorStack?.error?.stack} pluginInfo={pluginInfo} instance={instance} />
            );
        });
    }
};